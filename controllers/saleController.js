import Inventory from '../models/Inventory.js';
import Sale from '../models/Sale.js';
import AuditLog from '../models/AuditLog.js';
import xlsx from 'xlsx';

// ==================== SELL INVENTORY ====================
export const sellInventory = async (req, res) => {
  try {
    const { inventoryId, soldShapes, customer, invoiceNumber } = req.body;
    const ownerId = req.user.ownerId;

    if (!inventoryId || !soldShapes || soldShapes.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Inventory ID and sold shapes are required'
      });
    }

    const inventory = await Inventory.findOne({
      _id: inventoryId,
      ownerId,
      isDeleted: false
    });

    if (!inventory) {
      return res.status(404).json({ success: false, message: 'Inventory item not found' });
    }

    if (inventory.status === 'sold') {
      return res.status(400).json({ success: false, message: 'This item is already fully sold' });
    }

    // Validate each shape
    for (const sold of soldShapes) {
      if (inventory.shapeType === 'single') {
        if (sold.pieces > inventory.availablePieces) {
          return res.status(400).json({ success: false, message: `Only ${inventory.availablePieces} pieces available` });
        }
        if (sold.weight > inventory.availableWeight) {
          return res.status(400).json({ success: false, message: `Only ${inventory.availableWeight} carats available` });
        }
      } else {
        const invShape = inventory.shapes.find(s => s.shape === sold.shape);
        if (!invShape) {
          return res.status(400).json({ success: false, message: `Shape "${sold.shape}" not found in inventory` });
        }
        if (sold.pieces > invShape.pieces) {
          return res.status(400).json({ success: false, message: `Only ${invShape.pieces} pieces of ${sold.shape} available` });
        }
        if (sold.weight > invShape.weight) {
          return res.status(400).json({ success: false, message: `Only ${invShape.weight} carats of ${sold.shape} available` });
        }
      }
    }

    // Reduce inventory quantities
    for (const sold of soldShapes) {
      if (inventory.shapeType === 'single') {
        inventory.reduceQuantity(null, sold.pieces, sold.weight);
      } else {
        inventory.reduceQuantity(sold.shape, sold.pieces, sold.weight);
      }
    }
    await inventory.save();

    // Create sale record (saleRef auto-generated via pre-save hook)
    const totalPieces = soldShapes.reduce((sum, s) => sum + s.pieces, 0);
    const totalWeight = soldShapes.reduce((sum, s) => sum + s.weight, 0);
    const totalAmount = soldShapes.reduce((sum, s) => sum + (s.lineTotal || 0), 0);

    const sale = await Sale.create({
      inventoryId,
      soldShapes,
      totalPieces,
      totalWeight,
      totalAmount,
      customer: customer || {},
      invoiceNumber: invoiceNumber || undefined,
      ownerId
    });

    await sale.populate({
      path: 'inventoryId',
      select: 'serialNumber category shapeType singleShape shapes',
      populate: { path: 'category', select: 'name' }
    });

    // Audit log for sale creation
    try {
      await AuditLog.create({
        action: 'CREATE_SALE',
        entityType: 'sale',
        entityId: sale._id,
        performedBy: req.user._id || req.user.id,
        meta: {
          saleRef: sale.saleRef,
          serialNumber: inventory.serialNumber,
          customer: customer?.name || 'Walk-in',
          totalPieces,
          totalWeight,
          totalAmount,
          soldShapes: soldShapes.map(s => ({ shape: s.shape, pieces: s.pieces, weight: s.weight })),
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        ownerId,
      });
    } catch (auditErr) {
      console.error('Audit log error:', auditErr);
    }

    res.json({
      success: true,
      message: `Sale completed successfully. Ref: ${sale.saleRef}`,
      data: sale
    });
  } catch (error) {
    console.error('Error selling inventory:', error);
    res.status(500).json({ success: false, message: 'Failed to complete sale', error: error.message });
  }
};

// ==================== UNDO SALE (ADMIN ONLY) ====================
export const undoSale = async (req, res) => {
  try {
    const { id } = req.params;
    const ownerId = req.user.ownerId;

    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only admins can undo sales' });
    }

    const sale = await Sale.findOne({ _id: id, ownerId });
    if (!sale) return res.status(404).json({ success: false, message: 'Sale not found' });
    if (sale.cancelled) return res.status(400).json({ success: false, message: 'Sale already cancelled' });

    const inventory = await Inventory.findById(sale.inventoryId);
    if (!inventory) {
      return res.status(404).json({ success: false, message: 'Inventory item not found — it may have been deleted' });
    }

    for (const sold of sale.soldShapes) {
      if (inventory.shapeType === 'single') {
        inventory.restoreQuantity(null, sold.pieces, sold.weight);
      } else {
        inventory.restoreQuantity(sold.shape, sold.pieces, sold.weight);
      }
    }
    await inventory.save();

    sale.cancelled = true;
    sale.cancelledAt = new Date();
    sale.cancelledBy = req.user.id;
    sale.cancelReason = req.body.reason || 'Undone by admin';
    await sale.save();

    // Audit log for sale cancellation
    try {
      await AuditLog.create({
        action: 'CANCEL_SALE',
        entityType: 'sale',
        entityId: sale._id,
        performedBy: req.user._id || req.user.id,
        meta: {
          saleRef: sale.saleRef,
          serialNumber: inventory.serialNumber,
          reason: sale.cancelReason,
          totalAmount: sale.totalAmount,
          restoredPieces: sale.totalPieces,
          restoredWeight: sale.totalWeight,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        ownerId,
      });
    } catch (auditErr) {
      console.error('Audit log error:', auditErr);
    }

    res.json({ success: true, message: `Sale ${sale.saleRef} successfully undone. Inventory restored.` });
  } catch (error) {
    console.error('Error undoing sale:', error);
    res.status(500).json({ success: false, message: 'Failed to undo sale', error: error.message });
  }
};

// ==================== GET ALL SALES ====================
export const getAllSales = async (req, res) => {
  try {
    const { page = 1, limit = 10, sortOrder = 'desc', search = '', includeCancelled = 'false' } = req.query;
    const ownerId = req.user.ownerId;
    const pageNum = parseInt(page);
    const limitNum = Math.min(parseInt(limit) || 10, 100);

    if (isNaN(pageNum) || pageNum < 1) {
      return res.status(400).json({ success: false, message: 'Page must be a positive integer' });
    }

    const query = { ownerId };
    if (includeCancelled === 'false') query.cancelled = false;

    if (search && search.trim().length > 0) {
      const searchRegex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [
        { saleRef: searchRegex },
        { invoiceNumber: searchRegex },
        { 'customer.name': searchRegex },
        { 'customer.email': searchRegex },
        { 'customer.phone': searchRegex }
      ];
    }

    const skip = (pageNum - 1) * limitNum;

    const [sales, total] = await Promise.all([
      Sale.find(query)
        .populate({
          path: 'inventoryId',
          select: 'serialNumber category shapeType singleShape shapes availablePieces availableWeight',
          populate: { path: 'category', select: 'name' }
        })
        .populate('cancelledBy', 'username email')
        .sort({ soldAt: sortOrder === 'asc' ? 1 : -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Sale.countDocuments(query)
    ]);

    const mappedSales = sales.map((sale) => ({
      ...sale,
      id: sale._id,
      inventoryItem: sale.inventoryId ? {
        _id: sale.inventoryId._id,
        serialNumber: sale.inventoryId.serialNumber,
        category: sale.inventoryId.category,
        shapeType: sale.inventoryId.shapeType,
        singleShape: sale.inventoryId.singleShape,
        shapes: sale.inventoryId.shapes,
      } : null,
      price: sale.totalAmount,
      currency: 'INR',
      buyer: sale.customer?.name || 'Walk-in',
      soldDate: sale.soldAt,
      soldPieces: sale.totalPieces,
      soldWeight: sale.totalWeight,
    }));

    res.json({
      success: true,
      data: mappedSales,
      meta: { total, page: pageNum, pages: Math.ceil(total / limitNum), limit: limitNum }
    });
  } catch (error) {
    console.error('Error fetching sales:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch sales', error: error.message });
  }
};

// ==================== GET SINGLE SALE ====================
export const getSaleById = async (req, res) => {
  try {
    const sale = await Sale.findOne({ _id: req.params.id, ownerId: req.user.ownerId })
      .populate({
        path: 'inventoryId',
        select: 'serialNumber category singleShape shapes shapeType',
        populate: { path: 'category', select: 'name' }
      })
      .populate('cancelledBy', 'username email');

    if (!sale) return res.status(404).json({ success: false, message: 'Sale not found' });
    res.json({ success: true, data: sale });
  } catch (error) {
    console.error('Error fetching sale:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch sale', error: error.message });
  }
};

// ==================== EXPORT SALES TO EXCEL ====================
export const exportSalesExcel = async (req, res) => {
  try {
    const sales = await Sale.find({ ownerId: req.user.ownerId, cancelled: false })
      .populate({
        path: 'inventoryId',
        select: 'serialNumber category',
        populate: { path: 'category', select: 'name' }
      })
      .sort({ soldAt: -1 })
      .lean();

    const rows = sales.map((sale) => ({
      'Sale Ref': sale.saleRef || '-',
      'Serial Number': sale.inventoryId?.serialNumber || '-',
      'Category': sale.inventoryId?.category?.name || '-',
      'Shapes Sold': sale.soldShapes?.map(s => `${s.shape}: ${s.pieces}pcs / ${s.weight}ct`).join('; ') || '-',
      'Total Pieces': sale.totalPieces,
      'Total Weight (ct)': sale.totalWeight,
      'Total Amount': sale.totalAmount,
      'Customer Name': sale.customer?.name || '-',
      'Customer Email': sale.customer?.email || '-',
      'Customer Phone': sale.customer?.phone || '-',
      'Invoice Number': sale.invoiceNumber || '-',
      'Sale Date': sale.soldAt ? new Date(sale.soldAt).toLocaleDateString('en-IN') : '-',
    }));

    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.json_to_sheet(rows);
    ws['!cols'] = [
      { wch: 22 }, { wch: 15 }, { wch: 15 }, { wch: 35 },
      { wch: 12 }, { wch: 15 }, { wch: 15 }, { wch: 20 },
      { wch: 25 }, { wch: 15 }, { wch: 18 }, { wch: 15 },
    ];
    xlsx.utils.book_append_sheet(wb, ws, 'Sales');
    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Disposition', 'attachment; filename=sales-export.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error('Error exporting sales:', error);
    res.status(500).json({ success: false, message: 'Failed to export sales', error: error.message });
  }
};
