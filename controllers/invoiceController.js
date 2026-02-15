import Invoice from "../models/Invoice.js";
import Sale from "../models/Sale.js";
import Company from "../models/Company.js";
import Counter from "../models/Counter.js";
import mongoose from "mongoose";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import fs from "fs";
import path from "path";

const round = (num) => Math.round((num + Number.EPSILON) * 100) / 100;

// ==================== GENERATE INVOICE NUMBER ====================
async function generateInvoiceNumber(ownerId) {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");

  const company = await Company.findOne({ ownerId });

  let prefix = "INV";
  if (company?.companyName) {
    const firstWord = company.companyName.trim().split(/\s+/)[0];
    prefix = firstWord
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .substring(0, 8);
  }

  const counter = await Counter.findOneAndUpdate(
    { name: `invoice-${ownerId}-${year}` },
    { $inc: { value: 1 } },
    { new: true, upsert: true }
  );

  const padded = String(counter.value).padStart(5, "0");
  return `${prefix}/${year}-${month}/${padded}`;
}

// ==================== GENERATE QR CODE ====================
async function generateQRCode(invoice, company) {
  const qrData = JSON.stringify({
    sellerGstin: company?.gstNumber || "",
    sellerName: company?.companyName || "",
    invoiceNo: invoice.invoiceNumber,
    invoiceDate: new Date(invoice.issueDate).toLocaleDateString("en-IN"),
    totalAmount: invoice.total,
    taxAmount: invoice.taxAmount,
    items: invoice.items?.length || 0,
  });

  return QRCode.toDataURL(qrData, { width: 150, margin: 1 });
}

// ==================== CREATE BULK INVOICE ====================
export const createBulkInvoice = async (req, res) => {
  try {
    const { saleIds } = req.body;

    if (!saleIds || !Array.isArray(saleIds) || saleIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No sales provided. Select at least one sale.",
      });
    }

    const uniqueSaleIds = [...new Set(saleIds)];
    const ownerId = req.user.ownerId;

    // Fetch sales with populated inventory
    const sales = await Sale.find({
      _id: { $in: uniqueSaleIds },
      ownerId,
      cancelled: false,
    }).populate({
      path: "inventoryId",
      select: "serialNumber category weightUnit",
      populate: { path: "category", select: "name" },
    });

    if (!sales.length) {
      return res.status(404).json({
        success: false,
        message: "No valid active sales found",
      });
    }

    // Check if any of these sales already have an invoice
    const existingInvoice = await Invoice.findOne({
      saleIds: { $in: uniqueSaleIds },
      ownerId,
    });

    if (existingInvoice) {
      return res.status(400).json({
        success: false,
        message: `Some sales are already part of invoice ${existingInvoice.invoiceNumber}`,
      });
    }

    // Get company info for tax calculation
    const company = await Company.findOne({ ownerId });
    const taxRate = company?.taxRate || 0;
    const cgstRate = round(taxRate / 2);
    const sgstRate = round(taxRate / 2);

    // Build invoice items from sales
    const invoiceItems = sales.map((sale) => {
      const inventory = sale.inventoryId;
      const categoryName =
        typeof inventory?.category === "object"
          ? inventory.category?.name
          : "-";

      return {
        saleId: sale._id,
        serialNumber: inventory?.serialNumber || "-",
        category: categoryName,
        shapes: (sale.soldShapes || []).map((s) => ({
          shapeName: s.shape,
          pieces: s.pieces,
          weight: s.weight,
        })),
        soldPieces: sale.totalPieces,
        soldWeight: sale.totalWeight,
        weightUnit: inventory?.weightUnit || "ct",
        pricePerCarat:
          sale.totalWeight > 0
            ? round(sale.totalAmount / sale.totalWeight)
            : 0,
        lineTotal: sale.totalAmount,
      };
    });

    // Calculate totals
    const subtotal = round(
      invoiceItems.reduce((sum, item) => sum + item.lineTotal, 0)
    );
    const cgstAmount = round((subtotal * cgstRate) / 100);
    const sgstAmount = round((subtotal * sgstRate) / 100);
    const taxAmount = round(cgstAmount + sgstAmount);
    const total = round(subtotal + taxAmount);

    // Customer info from first sale
    const firstSale = sales[0];
    const customerName = firstSale.customer?.name || "Walk-in Customer";
    const customerEmail = firstSale.customer?.email || "";
    const customerPhone = firstSale.customer?.phone || "";

    // Generate invoice number
    const invoiceNumber = await generateInvoiceNumber(ownerId);

    // Create invoice
    const invoice = await Invoice.create({
      invoiceNumber,
      saleIds: uniqueSaleIds,
      customerName,
      customerEmail,
      customerPhone,
      items: invoiceItems,
      subtotal,
      taxRate,
      cgstRate,
      sgstRate,
      cgstAmount,
      sgstAmount,
      taxAmount,
      total,
      currency: "INR",
      placeOfSupply: company?.state || "",
      ownerId,
      createdBy: req.user._id,
    });

    // Generate QR code
    try {
      const qrCodeDataUrl = await generateQRCode(invoice, company);
      invoice.qrCodeDataUrl = qrCodeDataUrl;
      await invoice.save();
    } catch (qrErr) {
      console.error("QR generation failed (non-critical):", qrErr);
    }

    // Update sales with invoice number
    await Sale.updateMany(
      { _id: { $in: uniqueSaleIds } },
      { $set: { invoiceNumber: invoice.invoiceNumber } }
    );

    // Return populated invoice
    const populated = await Invoice.findById(invoice._id).populate({
      path: "saleIds",
      populate: {
        path: "inventoryId",
        select: "serialNumber category weightUnit",
        populate: { path: "category", select: "name" },
      },
    });

    res.json({
      success: true,
      data: populated,
      message: `Invoice ${invoiceNumber} created with ${sales.length} sale(s)`,
    });
  } catch (error) {
    console.error("Create bulk invoice error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to create invoice",
    });
  }
};

// ==================== GET INVOICE BY SALE ID ====================
export const getInvoiceBySaleId = async (req, res) => {
  try {
    const saleId = req.params.saleId;
    const ownerId = req.user.ownerId;

    // Find invoice containing this sale
    let invoice = await Invoice.findOne({
      saleIds: saleId,
      ownerId,
    }).populate({
      path: "saleIds",
      populate: {
        path: "inventoryId",
        select: "serialNumber category weightUnit",
        populate: { path: "category", select: "name" },
      },
    });

    if (!invoice) {
      // Auto-create invoice for this single sale
      const sale = await Sale.findOne({
        _id: saleId,
        ownerId,
        cancelled: false,
      }).populate({
        path: "inventoryId",
        select: "serialNumber category weightUnit",
        populate: { path: "category", select: "name" },
      });

      if (!sale) {
        return res.status(404).json({
          success: false,
          message: "Sale not found",
        });
      }

      const company = await Company.findOne({ ownerId });
      const taxRate = company?.taxRate || 0;
      const cgstRate = round(taxRate / 2);
      const sgstRate = round(taxRate / 2);

      const inventory = sale.inventoryId;
      const categoryName =
        typeof inventory?.category === "object"
          ? inventory.category?.name
          : "-";

      const subtotal = sale.totalAmount;
      const cgstAmount = round((subtotal * cgstRate) / 100);
      const sgstAmount = round((subtotal * sgstRate) / 100);
      const taxAmount = round(cgstAmount + sgstAmount);
      const total = round(subtotal + taxAmount);

      const invoiceNumber = await generateInvoiceNumber(ownerId);

      invoice = await Invoice.create({
        invoiceNumber,
        saleIds: [sale._id],
        customerName: sale.customer?.name || "Walk-in Customer",
        customerEmail: sale.customer?.email || "",
        customerPhone: sale.customer?.phone || "",
        items: [{
          saleId: sale._id,
          serialNumber: inventory?.serialNumber || "-",
          category: categoryName,
          shapes: (sale.soldShapes || []).map((s) => ({
            shapeName: s.shape,
            pieces: s.pieces,
            weight: s.weight,
          })),
          soldPieces: sale.totalPieces,
          soldWeight: sale.totalWeight,
          weightUnit: inventory?.weightUnit || "ct",
          pricePerCarat:
            sale.totalWeight > 0
              ? round(sale.totalAmount / sale.totalWeight)
              : 0,
          lineTotal: sale.totalAmount,
        }],
        subtotal,
        taxRate,
        cgstRate,
        sgstRate,
        cgstAmount,
        sgstAmount,
        taxAmount,
        total,
        currency: "INR",
        placeOfSupply: company?.state || "",
        ownerId,
        createdBy: req.user._id,
      });

      // Generate QR
      try {
        const qrCodeDataUrl = await generateQRCode(invoice, company);
        invoice.qrCodeDataUrl = qrCodeDataUrl;
        await invoice.save();
      } catch (qrErr) {
        console.error("QR generation failed:", qrErr);
      }

      // Update sale with invoice number
      await Sale.updateOne(
        { _id: sale._id },
        { $set: { invoiceNumber: invoice.invoiceNumber } }
      );

      // Re-populate
      invoice = await Invoice.findById(invoice._id).populate({
        path: "saleIds",
        populate: {
          path: "inventoryId",
          select: "serialNumber category weightUnit",
          populate: { path: "category", select: "name" },
        },
      });
    }

    res.json({ success: true, data: invoice });
  } catch (error) {
    console.error("Get invoice by sale error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch invoice",
    });
  }
};

// ==================== GET INVOICE BY ID ====================
export const getInvoiceById = async (req, res) => {
  try {
    const invoice = await Invoice.findOne({
      _id: req.params.id,
      ownerId: req.user.ownerId,
    }).populate({
      path: "saleIds",
      populate: {
        path: "inventoryId",
        select: "serialNumber category weightUnit",
        populate: { path: "category", select: "name" },
      },
    });

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: "Invoice not found",
      });
    }

    res.json({ success: true, data: invoice });
  } catch (error) {
    console.error("Get invoice error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch invoice",
    });
  }
};

// ==================== DOWNLOAD INVOICE PDF ====================
export const downloadInvoicePDF = async (req, res) => {
  try {
    const invoice = await Invoice.findOne({
      _id: req.params.id,
      ownerId: req.user.ownerId,
    }).populate({
      path: "saleIds",
      populate: {
        path: "inventoryId",
        select: "serialNumber category weightUnit",
        populate: { path: "category", select: "name" },
      },
    });

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: "Invoice not found",
      });
    }

    const company = await Company.findOne({ ownerId: req.user.ownerId });

    // Create PDF
    const doc = new PDFDocument({ size: "A4", margin: 40 });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${invoice.invoiceNumber.replace(/\//g, "-")}.pdf`
    );

    doc.pipe(res);

    const pageWidth = doc.page.width - 80; // 40 margin each side
    const leftX = 40;
    const rightX = doc.page.width - 40;

    // Color constants
    const accentColor = "#B45309"; // amber-700
    const darkGray = "#1F2937";
    const medGray = "#6B7280";
    const lightGray = "#9CA3AF";

    // ---- TOP ACCENT BAR ----
    doc.rect(0, 0, doc.page.width, 6).fill(accentColor);

    // ---- HEADER: COMPANY + INVOICE META ----
    let companyStartY = 22;

    // Company Logo
    let logoEndX = leftX;
    if (company?.logoUrl) {
      try {
        const logoPath = path.join(process.cwd(), company.logoUrl);
        if (fs.existsSync(logoPath)) {
          doc.image(logoPath, leftX, companyStartY, {
            width: 50,
            height: 50,
            fit: [50, 50],
          });
          logoEndX = leftX + 58;
        }
      } catch (logoErr) {
        // Logo failed, skip silently
      }
    }

    // Company Name
    doc.fontSize(16).font("Helvetica-Bold").fillColor(darkGray).text(
      company?.companyName || "Company Name",
      logoEndX,
      companyStartY
    );

    // Company Details
    doc.fontSize(8).font("Helvetica").fillColor(medGray);
    let detailY = companyStartY + 20;

    if (company?.address) {
      let addr = company.address;
      if (company.city) addr += `, ${company.city}`;
      if (company.state) addr += `, ${company.state}`;
      if (company.pincode) addr += ` - ${company.pincode}`;
      doc.text(addr, logoEndX, detailY, { width: pageWidth / 2 - 20 });
      detailY = doc.y + 2;
    }

    const contactParts = [];
    if (company?.phone) contactParts.push(company.phone);
    if (company?.email) contactParts.push(company.email);
    if (contactParts.length) {
      doc.text(contactParts.join("  |  "), logoEndX, detailY);
      detailY = doc.y + 2;
    }

    if (company?.gstNumber) {
      doc.font("Helvetica-Bold").fillColor(darkGray).text(`GSTIN: ${company.gstNumber}`, logoEndX, detailY);
      detailY = doc.y + 1;
      doc.font("Helvetica").fillColor(medGray);
    }
    if (company?.panNumber) {
      doc.text(`PAN: ${company.panNumber}`, logoEndX, detailY);
    }

    // ---- TAX INVOICE TITLE (right side) ----
    doc.fontSize(18).font("Helvetica-Bold").fillColor(accentColor).text(
      "TAX INVOICE",
      rightX - 200,
      companyStartY,
      { width: 200, align: "right" }
    );
    doc.fontSize(7).font("Helvetica").fillColor(lightGray).text(
      "Under Section 31 of CGST/SGST Act",
      rightX - 200,
      companyStartY + 20,
      { width: 200, align: "right" }
    );

    // Invoice Number Box
    const invBoxY = companyStartY + 35;
    doc.roundedRect(rightX - 170, invBoxY, 170, 34, 4)
      .fillAndStroke("#F9FAFB", "#E5E7EB");

    doc.fontSize(7).font("Helvetica").fillColor(lightGray).text(
      "INVOICE NO",
      rightX - 165,
      invBoxY + 5,
      { width: 160, align: "right" }
    );
    doc.fontSize(10).font("Helvetica-Bold").fillColor(darkGray).text(
      invoice.invoiceNumber,
      rightX - 165,
      invBoxY + 16,
      { width: 160, align: "right" }
    );

    // Date & Place of Supply
    doc.fontSize(8).font("Helvetica").fillColor(medGray).text(
      `Date: ${new Date(invoice.issueDate).toLocaleDateString("en-IN", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })}`,
      rightX - 200,
      invBoxY + 42,
      { width: 200, align: "right" }
    );
    if (invoice.placeOfSupply) {
      doc.text(
        `Place of Supply: ${invoice.placeOfSupply}`,
        rightX - 200,
        invBoxY + 54,
        { width: 200, align: "right" }
      );
    }

    // ---- DIVIDER ----
    const dividerY = Math.max(doc.y, invBoxY + 68) + 10;
    doc.moveTo(leftX, dividerY).lineTo(rightX, dividerY).strokeColor("#E5E7EB").stroke();

    // ---- BILL TO ----
    const billToY = dividerY + 8;

    // Bill To background
    doc.roundedRect(leftX, billToY, pageWidth, 52, 4)
      .fillAndStroke("#F9FAFB", "#E5E7EB");

    doc.fontSize(7).font("Helvetica-Bold").fillColor(accentColor).text(
      "BILL TO",
      leftX + 12,
      billToY + 8
    );

    // Customer name
    doc.fontSize(11).font("Helvetica-Bold").fillColor(darkGray).text(
      invoice.customerName || "Walk-in Customer",
      leftX + 12,
      billToY + 20
    );

    // Customer details on right
    const custDetailsX = leftX + pageWidth / 2;
    let custY = billToY + 10;
    doc.fontSize(8).font("Helvetica").fillColor(medGray);

    if (invoice.customerPhone) {
      doc.text(`Phone: ${invoice.customerPhone}`, custDetailsX, custY);
      custY += 12;
    }
    if (invoice.customerEmail) {
      doc.text(`Email: ${invoice.customerEmail}`, custDetailsX, custY);
      custY += 12;
    }
    if (invoice.customerGstin) {
      doc.font("Helvetica-Bold").fillColor(darkGray).text(
        `GSTIN: ${invoice.customerGstin}`,
        custDetailsX,
        custY
      );
    }

    // Customer address below name
    doc.fontSize(8).font("Helvetica").fillColor(medGray);
    if (invoice.customerAddress) {
      doc.text(invoice.customerAddress, leftX + 12, billToY + 34, { width: pageWidth / 2 - 20 });
    }

    // ---- ITEMS TABLE ----
    const tableY = billToY + 62;

    // Table header background
    const headerHeight = 22;
    doc.roundedRect(leftX, tableY, pageWidth, headerHeight, 3)
      .fill(darkGray);

    // Table columns
    const cols = [
      { label: "#", x: leftX + 6, w: 22 },
      { label: "Description", x: leftX + 28, w: 130 },
      { label: "HSN", x: leftX + 158, w: 40 },
      { label: "Qty", x: leftX + 198, w: 45 },
      { label: "Weight", x: leftX + 243, w: 55 },
      { label: "Rate/ct", x: leftX + 298, w: 60 },
      { label: "Amount", x: leftX + 358, w: pageWidth - 358 },
    ];

    doc.fontSize(8).font("Helvetica-Bold").fillColor("#FFFFFF");
    cols.forEach((col) => {
      doc.text(col.label, col.x, tableY + 6, {
        width: col.w,
        align: col.x > leftX + 158 ? "right" : "left",
      });
    });

    // Table rows
    let rowY = tableY + headerHeight + 6;
    doc.fillColor(darkGray);

    invoice.items.forEach((item, idx) => {
      if (rowY > doc.page.height - 200) {
        doc.addPage();
        rowY = 40;
      }

      // Alternating row background
      if (idx % 2 === 1) {
        doc.rect(leftX, rowY - 3, pageWidth, 20).fill("#FAFAFA");
        doc.fillColor(darkGray);
      }

      const desc = `${item.serialNumber} - ${item.category}`;
      const shapesText = (item.shapes || [])
        .map((s) => `${s.shapeName}: ${s.pieces}pcs/${s.weight}ct`)
        .join(", ");

      doc.fontSize(8).font("Helvetica");

      // Row number
      doc.fillColor(lightGray).text(String(idx + 1), cols[0].x, rowY, { width: cols[0].w });

      // Description
      doc.font("Helvetica-Bold").fillColor(darkGray).text(desc, cols[1].x, rowY, { width: cols[1].w });

      // HSN
      doc.font("Helvetica").fillColor(medGray).text(item.hsnCode || "7103", cols[2].x, rowY, {
        width: cols[2].w,
        align: "right",
      });

      // Qty
      doc.fillColor(darkGray).text(String(item.soldPieces), cols[3].x, rowY, {
        width: cols[3].w,
        align: "right",
      });

      // Weight
      doc.text(`${item.soldWeight} ${item.weightUnit}`, cols[4].x, rowY, {
        width: cols[4].w,
        align: "right",
      });

      // Rate
      doc.text(
        item.pricePerCarat > 0 ? `₹${item.pricePerCarat.toLocaleString("en-IN")}` : "-",
        cols[5].x,
        rowY,
        { width: cols[5].w, align: "right" }
      );

      // Amount
      doc.font("Helvetica-Bold").fillColor(darkGray).text(
        `₹${item.lineTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`,
        cols[6].x,
        rowY,
        { width: cols[6].w, align: "right" }
      );

      // Shapes detail below
      if (shapesText) {
        rowY += 13;
        doc.fontSize(7).font("Helvetica").fillColor(lightGray).text(
          shapesText,
          cols[1].x + 4,
          rowY,
          { width: 350 }
        );
      }

      rowY += 18;
    });

    // ---- TOTALS ----
    const totalsX = rightX - 220;
    doc.moveTo(leftX, rowY).lineTo(rightX, rowY).strokeColor("#E5E7EB").stroke();
    rowY += 10;

    const formatINR = (amt) =>
      `₹${amt.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

    const drawTotalRow = (label, value, bold = false, highlight = false) => {
      if (highlight) {
        doc.roundedRect(totalsX - 5, rowY - 4, 225, 22, 3).fill(accentColor);
        doc.fontSize(10).font("Helvetica-Bold").fillColor("#FFFFFF");
        doc.text(label, totalsX, rowY, { width: 120 });
        doc.text(value, rightX - 100, rowY, { width: 100, align: "right" });
        doc.fillColor(darkGray);
        rowY += 26;
      } else {
        doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9).fillColor(bold ? darkGray : medGray);
        doc.text(label, totalsX, rowY, { width: 120 });
        doc.fillColor(darkGray).text(value, rightX - 100, rowY, { width: 100, align: "right" });
        rowY += 16;
      }
    };

    drawTotalRow("Subtotal", formatINR(invoice.subtotal));

    if (invoice.taxRate > 0) {
      drawTotalRow(`CGST @ ${invoice.cgstRate}%`, formatINR(invoice.cgstAmount));
      drawTotalRow(`SGST @ ${invoice.sgstRate}%`, formatINR(invoice.sgstAmount));
    }

    if (invoice.discount > 0) {
      drawTotalRow("Discount", `-${formatINR(invoice.discount)}`);
    }

    drawTotalRow("TOTAL", formatINR(invoice.total), true, true);

    // ---- AMOUNT IN WORDS ----
    rowY += 4;
    doc.roundedRect(leftX, rowY, pageWidth, 22, 3)
      .fillAndStroke("#FFFBEB", "#FDE68A");

    doc.fontSize(8).font("Helvetica-Bold").fillColor(accentColor).text(
      `Amount in Words: `,
      leftX + 10,
      rowY + 6,
      { continued: true }
    );
    doc.font("Helvetica").fillColor(darkGray).text(
      `${numberToWords(Math.floor(invoice.total))} Rupees Only`
    );

    // ---- BOTTOM SECTION ----
    const bottomY = Math.min(rowY + 40, doc.page.height - 150);

    // QR Code
    if (invoice.qrCodeDataUrl) {
      try {
        doc.roundedRect(leftX, bottomY, 76, 76, 4)
          .fillAndStroke("#FFFFFF", "#E5E7EB");
        doc.image(invoice.qrCodeDataUrl, leftX + 6, bottomY + 6, {
          width: 64,
          height: 64,
        });
        doc.fontSize(6).fillColor(lightGray).text(
          "Scan for details",
          leftX,
          bottomY + 80,
          { width: 76, align: "center" }
        );
      } catch (imgErr) {
        // QR image failed, skip silently
      }
    }

    // Bank Details
    if (company?.bankName) {
      const bankX = leftX + 100;
      doc.roundedRect(bankX, bottomY, 180, 72, 4)
        .fillAndStroke("#F9FAFB", "#F3F4F6");

      doc.fontSize(7).font("Helvetica-Bold").fillColor(accentColor).text(
        "BANK DETAILS",
        bankX + 10,
        bottomY + 8
      );
      doc.fontSize(8).font("Helvetica-Bold").fillColor(darkGray).text(
        company.bankName,
        bankX + 10,
        bottomY + 20
      );
      doc.font("Helvetica").fontSize(8).fillColor(medGray);
      let bankDetailY = bottomY + 32;
      if (company.bankAccountNumber) {
        doc.text(`A/C: ${company.bankAccountNumber}`, bankX + 10, bankDetailY);
        bankDetailY += 12;
      }
      if (company.bankIfscCode) {
        doc.text(`IFSC: ${company.bankIfscCode}`, bankX + 10, bankDetailY);
        bankDetailY += 12;
      }
      if (company.bankBranch) {
        doc.text(`Branch: ${company.bankBranch}`, bankX + 10, bankDetailY);
      }
    }

    // Signature
    const sigX = rightX - 140;
    const sigY = bottomY;

    if (company?.signatureUrl) {
      try {
        const sigPath = path.join(process.cwd(), company.signatureUrl);
        if (fs.existsSync(sigPath)) {
          doc.image(sigPath, sigX + 20, sigY, {
            width: 100,
            height: 40,
            fit: [100, 40],
          });
        }
      } catch (sigErr) {
        // Signature image failed, skip
      }
    }

    // Signature line
    const sigLineY = sigY + 48;
    doc.moveTo(sigX, sigLineY).lineTo(sigX + 140, sigLineY)
      .lineWidth(1.5).strokeColor(darkGray).stroke();

    doc.fontSize(8).font("Helvetica-Bold").fillColor(darkGray).text(
      "Authorized Signatory",
      sigX,
      sigLineY + 4,
      { width: 140, align: "center" }
    );
    doc.fontSize(7).font("Helvetica").fillColor(medGray).text(
      company?.companyName || "",
      sigX,
      sigLineY + 16,
      { width: 140, align: "center" }
    );

    // ---- TERMS ----
    if (company?.termsAndConditions) {
      const termsY = Math.max(doc.y + 10, bottomY + 95);
      doc.moveTo(leftX, termsY).lineTo(rightX, termsY).strokeColor("#E5E7EB").lineWidth(0.5).stroke();
      doc.fontSize(7).font("Helvetica-Bold").fillColor(lightGray).text(
        "TERMS & CONDITIONS",
        leftX,
        termsY + 4
      );
      doc.fontSize(7).font("Helvetica").fillColor(medGray).text(
        company.termsAndConditions,
        leftX,
        termsY + 14,
        { width: pageWidth }
      );
    }

    // ---- FOOTER ----
    doc.fontSize(7).fillColor(lightGray).text(
      "This is a computer-generated invoice.",
      leftX,
      doc.page.height - 30,
      { align: "center", width: pageWidth }
    );

    // ---- BOTTOM ACCENT BAR ----
    doc.rect(0, doc.page.height - 4, doc.page.width, 4).fill(accentColor);

    doc.end();
  } catch (error) {
    console.error("PDF generation error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: "Failed to generate PDF",
      });
    }
  }
};

// ==================== NUMBER TO WORDS (Indian System) ====================
function numberToWords(num) {
  if (num === 0) return "Zero";

  const ones = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
    "Seventeen", "Eighteen", "Nineteen",
  ];
  const tens = [
    "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy",
    "Eighty", "Ninety",
  ];

  const convertBelowHundred = (n) => {
    if (n < 20) return ones[n];
    return tens[Math.floor(n / 10)] + (n % 10 ? " " + ones[n % 10] : "");
  };

  const convertBelowThousand = (n) => {
    if (n < 100) return convertBelowHundred(n);
    return (
      ones[Math.floor(n / 100)] +
      " Hundred" +
      (n % 100 ? " and " + convertBelowHundred(n % 100) : "")
    );
  };

  // Indian numbering: Lakh (1,00,000) and Crore (1,00,00,000)
  let result = "";
  if (num >= 10000000) {
    result += convertBelowThousand(Math.floor(num / 10000000)) + " Crore ";
    num %= 10000000;
  }
  if (num >= 100000) {
    result += convertBelowHundred(Math.floor(num / 100000)) + " Lakh ";
    num %= 100000;
  }
  if (num >= 1000) {
    result += convertBelowHundred(Math.floor(num / 1000)) + " Thousand ";
    num %= 1000;
  }
  if (num > 0) {
    result += convertBelowThousand(num);
  }

  return result.trim();
}
