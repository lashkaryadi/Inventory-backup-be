import PDFDocument from "pdfkit";

export function generateInvoicePDF(invoice) {
  const doc = new PDFDocument({ size: "A4", margin: 50 });

  doc.fontSize(20).text("INVOICE", { align: "center" });
  doc.moveDown();

  doc.fontSize(12);
  doc.text(`Invoice No: ${invoice.invoiceNumber}`);
  doc.text(`Invoice Date: ${new Date(invoice.invoiceDate).toDateString()}`);
  doc.moveDown();

  doc.text(`Buyer: ${invoice.buyer || "-"}`);
  doc.text(`Currency: ${invoice.currency}`);
  doc.moveDown();

  doc.text("Item Details", { underline: true });
  doc.moveDown(0.5);

  const item = invoice.soldItem.inventoryItem;

  doc.text(`Serial Number: ${item.serialNumber}`);
  doc.text(`Category: ${item.category?.name || "-"}`);
  doc.text(`Weight: ${item.weight} ${item.weightUnit}`);
  doc.moveDown();

  doc.fontSize(14).text(
    `Total Amount: ${invoice.currency} ${invoice.amount}`,
    { align: "right" }
  );

  doc.moveDown(2);
  doc.fontSize(10).text("Thank you for your business!", {
    align: "center",
  });

  return doc;
}
