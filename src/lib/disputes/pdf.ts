/**
 * Evidence PDF for a dispute: the order, tracking, offers, refunds, the agent's audit timeline and the full
 * conversation with the buyer — printed from the case record, so it contains nothing the model wrote
 * except the response summary the merchant approved.
 */
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import type { DisputeRecord } from "./record";

const PAGE = { width: 612, height: 792, margin: 54 }; // US Letter
const INK = rgb(0.1, 0.1, 0.12);
const MUTED = rgb(0.42, 0.42, 0.46);
const ACCENT = rgb(0.016, 0.47, 0.34);

/** Standard PDF fonts only cover Latin-1 (WinAnsi): swap typographic characters and drop the rest. */
export function pdfSafe(text: string): string {
  return text
    .replace(/[“”„]/g, '"')
    .replace(/[‘’‚]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/→/g, "->")
    .replace(/×/g, "x")
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "");
}

const money = (cents: number | null | undefined, currency = "USD") =>
  cents == null ? "-" : new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
const when = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "-");

class Writer {
  page!: PDFPage;
  y = 0;
  constructor(
    private doc: PDFDocument,
    private font: PDFFont,
    private bold: PDFFont,
  ) {
    this.newPage();
  }

  newPage() {
    this.page = this.doc.addPage([PAGE.width, PAGE.height]);
    this.y = PAGE.height - PAGE.margin;
  }

  ensure(height: number) {
    if (this.y - height < PAGE.margin + 20) this.newPage();
  }

  private wrap(text: string, font: PDFFont, size: number, width: number): string[] {
    const lines: string[] = [];
    for (const paragraph of pdfSafe(text).split("\n")) {
      let line = "";
      for (const word of paragraph.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) > width && line) {
          lines.push(line);
          line = word;
        } else line = next;
      }
      lines.push(line);
    }
    return lines;
  }

  text(text: string, opts: { size?: number; bold?: boolean; color?: typeof INK; indent?: number; gap?: number } = {}) {
    const size = opts.size ?? 9.5;
    const font = opts.bold ? this.bold : this.font;
    const x = PAGE.margin + (opts.indent ?? 0);
    for (const line of this.wrap(text, font, size, PAGE.width - PAGE.margin - x)) {
      this.ensure(size + 3);
      this.page.drawText(line, { x, y: this.y - size, size, font, color: opts.color ?? INK });
      this.y -= size + 3;
    }
    this.y -= opts.gap ?? 2;
  }

  heading(text: string) {
    this.ensure(40);
    this.y -= 10;
    this.text(text, { size: 12, bold: true, color: ACCENT, gap: 4 });
  }

  pair(label: string, value: string) {
    this.ensure(14);
    const size = 9.5;
    this.page.drawText(pdfSafe(label), { x: PAGE.margin, y: this.y - size, size, font: this.bold, color: MUTED });
    const startY = this.y;
    this.text(value, { indent: 130, gap: 0 });
    if (this.y === startY) this.y -= size + 3;
  }
}

export async function buildEvidencePdf(record: DisputeRecord, summary: { responseText: string; version?: number }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(pdfSafe(`Dispute ${record.dispute.paypalDisputeId} - case record`));
  doc.setAuthor(pdfSafe(record.store));
  doc.setProducer("FirstReply");
  const w = new Writer(doc, await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold));

  w.text(`${record.store} - case record for PayPal dispute ${record.dispute.paypalDisputeId}`, { size: 15, bold: true, gap: 4 });
  w.text(`Generated ${when(new Date())} by FirstReply from the store's append-only audit log.`, { color: MUTED, gap: 8 });

  w.heading("Dispute");
  w.pair("Reason", record.dispute.reason.replace(/_/g, " "));
  w.pair("Amount", money(record.dispute.amountCents, record.dispute.currency));
  w.pair("Opened", when(record.dispute.openedAt));
  for (const s of record.dispute.buyerStatements) w.pair("Buyer's statement", `"${s.text}"`);

  w.heading("Store's response");
  w.text(summary.responseText);

  const o = record.order;
  if (o) {
    w.heading("Order");
    w.pair("Order", `${o.number} - paid ${when(o.paidAt)}`);
    w.pair("Total", `${money(o.totalCents, o.currency)}${o.refundedCents ? ` (refunded ${money(o.refundedCents, o.currency)})` : ""}`);
    w.pair("PayPal capture", o.captureId ?? "-");
    w.pair("Ships to", o.shipsTo || "-");
    for (const i of o.items) w.pair("Item", `${i.name} x ${i.quantity} @ ${money(i.unitPriceCents, o.currency)}`);

    w.heading("Shipping and tracking");
    if (!o.shipments.length) w.text("No shipment on file.");
    for (const s of o.shipments) w.pair(s.isReplacement ? "Replacement" : "Shipment", `${s.carrier} ${s.trackingNumber} - shipped ${when(s.shippedAt)} - latest status: ${s.status.replace("_", " ")}`);

    if (o.refunds.length) {
      w.heading("Refunds");
      for (const r of o.refunds) w.pair(when(r.at), `${money(r.amountCents, o.currency)} - PayPal refund ${r.paypalRefundId ?? "-"}`);
    }
  }

  const c = record.caseRecord;
  if (c) {
    w.heading("Contact before the dispute");
    w.text(
      c.contactedStoreFirst
        ? `The buyer contacted the store on ${when(c.openedAt)}, before opening the PayPal dispute on ${when(record.dispute.openedAt)}.`
        : "The buyer opened the PayPal dispute without contacting the store first.",
    );
    if (c.offers.length) {
      w.heading("Fixes offered");
      for (const x of c.offers) w.pair(x.type.replace(/_/g, " "), `${x.amountCents ? `${money(x.amountCents)} - ` : ""}${x.status.replace(/_/g, " ")} (offered ${when(x.offeredAt)}, answered ${when(x.answeredAt)})`);
    }
    w.heading("What the store did (audit log)");
    for (const t of c.timeline) {
      w.text(`${when(t.at)}  ${t.title}${t.detail ? ` - ${t.detail}` : ""}`, { gap: 0 });
      for (const r of t.reasons) w.text(r, { indent: 14, color: MUTED, gap: 0 });
      w.y -= 3;
    }
    w.heading("Conversation with the buyer (verbatim)");
    for (const m of c.conversation) {
      w.ensure(30); // keep the speaker line with its message
      w.text(`${when(m.at)} - ${m.from === "buyer" ? "Buyer" : record.store}`, { bold: true, size: 8.5, color: MUTED, gap: 0 });
      w.text(m.text, { gap: 6 });
    }
  }

  // Page numbers.
  const pages = doc.getPages();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  pages.forEach((p, i) => p.drawText(`${i + 1} / ${pages.length}`, { x: PAGE.width - PAGE.margin - 30, y: 30, size: 8, font, color: MUTED }));
  return doc.save();
}
