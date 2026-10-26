/**
 * Day 1: exercises every PayPal sandbox call FirstReply depends on.
 * Run `npm run paypal:spike` with no arguments for the command list, and see docs/day1-setup.md for the order.
 */
import "@/lib/load-env";
import { getAccessToken, PayPalError, paypalRequest } from "@/lib/paypal/client";
import { runToolkitTool, ToolkitError } from "@/lib/paypal/toolkit";

// Shows on the buyer's card statement (max 22 chars). In the real product this carries the help link.
const SOFT_DESCRIPTOR = "FIRSTREPLY DEMO";

type Link = { href: string; rel: string };
type Order = {
  id: string;
  status: string;
  links?: Link[];
  purchase_units?: { payments?: { captures?: { id: string; status: string; amount: { value: string } }[] } }[];
};
type Dispute = { dispute_id: string; reason: string; status: string; dispute_life_cycle_stage?: string; create_time: string };

const print = (label: string, value: unknown) => console.log(`\n${label}\n${JSON.stringify(value, null, 2)}`);

function need(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing <${name}>. Run with no arguments to see usage.`);
  return value;
}

const commands: Record<string, { usage: string; run: (args: string[]) => Promise<void> }> = {
  token: {
    usage: "token                                  get an access token and list its scopes",
    run: async () => {
      const token = await getAccessToken();
      const scopes = token.scope.split(" ");
      const interesting = scopes.filter((s) => /dispute|reporting|refund|tracker|shipping|checkout|payments\/payment/.test(s));
      console.log(`Token OK — ${scopes.length} scopes. Relevant ones:\n  ${interesting.join("\n  ")}`);
      for (const s of ["disputes/read-seller", "disputes/update-seller", "reporting/search/read"]) {
        console.log(`${scopes.some((x) => x.includes(s)) ? "  ✔" : "  ✘ missing"} ${s}`);
      }
    },
  },

  "create-order": {
    usage: "create-order [amount]                  create an order (with soft descriptor); prints the approve link",
    run: async ([amount = "25.00"]) => {
      const value = Number(amount).toFixed(2);
      const order = await paypalRequest<Order>("/v2/checkout/orders", {
        method: "POST",
        body: {
          intent: "CAPTURE",
          purchase_units: [
            {
              reference_id: `spike-${Date.now()}`,
              description: "FirstReply spike test item",
              soft_descriptor: SOFT_DESCRIPTOR,
              amount: { currency_code: "USD", value },
            },
          ],
          payment_source: {
            paypal: {
              experience_context: {
                user_action: "PAY_NOW",
                shipping_preference: "GET_FROM_FILE",
                return_url: "http://localhost:3000/paypal/return",
                cancel_url: "http://localhost:3000/paypal/cancel",
              },
            },
          },
        },
      });
      const approve = order.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
      console.log(`Order ${order.id} (${order.status})`);
      console.log(`\n1. Open this link and log in as a sandbox BUYER:\n   ${approve}`);
      console.log(`2. Then run:  npm run paypal:spike -- capture ${order.id}`);
    },
  },

  capture: {
    usage: "capture <orderId>                      capture an approved order; prints the capture ID",
    run: async ([orderId]) => {
      const order = await paypalRequest<Order>(`/v2/checkout/orders/${need(orderId, "orderId")}/capture`, { method: "POST", body: {} });
      const capture = order.purchase_units?.[0]?.payments?.captures?.[0];
      console.log(`Order ${order.id} → ${order.status}`);
      console.log(`Capture ID: ${capture?.id}  (${capture?.status}, $${capture?.amount.value})`);
    },
  },

  "get-order": {
    usage: "get-order <orderId>                    read the order through the Agent Toolkit",
    run: async ([orderId]) => print("Toolkit get_order:", await runToolkitTool("get_order", { id: need(orderId, "orderId") })),
  },

  track: {
    usage: "track <orderId> <captureId> [status]   add a shipment tracker (toolkit)",
    run: async ([orderId, captureId, status = "SHIPPED"]) => {
      const trackingNumber = `1Z${Date.now()}`;
      const result = await runToolkitTool("create_shipment_tracking", {
        order_id: need(orderId, "orderId"),
        transaction_id: need(captureId, "captureId"),
        tracking_number: trackingNumber,
        carrier: "UPS",
        status,
      });
      print(`Toolkit create_shipment_tracking (tracking number ${trackingNumber}):`, result);
    },
  },

  "track-get": {
    usage: "track-get <orderId> <captureId>        read the tracker back (toolkit)",
    run: async ([orderId, captureId]) =>
      print(
        "Toolkit get_shipment_tracking:",
        await runToolkitTool("get_shipment_tracking", { order_id: need(orderId, "orderId"), transaction_id: need(captureId, "captureId") }),
      ),
  },

  "track-update": {
    usage: "track-update <captureId> <trackingNo> <status>   change tracker status, e.g. ON_HOLD / DELIVERED (toolkit)",
    run: async ([captureId, trackingNumber, status]) =>
      print(
        "Toolkit update_shipment_tracking:",
        await runToolkitTool("update_shipment_tracking", {
          transaction_id: need(captureId, "captureId"),
          tracking_number: need(trackingNumber, "trackingNo"),
          status: need(status, "status"),
        }),
      ),
  },

  refund: {
    usage: "refund <captureId> [amount]            full or partial refund (toolkit)",
    run: async ([captureId, amount]) =>
      print(
        "Toolkit create_refund:",
        await runToolkitTool("create_refund", {
          capture_id: need(captureId, "captureId"),
          ...(amount && { amount: { currency_code: "USD", value: Number(amount).toFixed(2) } }),
          note_to_payer: "FirstReply spike test refund",
        }),
      ),
  },

  transactions: {
    usage: "transactions                           list the last 31 days of transactions (toolkit)",
    run: async () => print("Toolkit list_transactions:", await runToolkitTool("list_transactions", {})),
  },

  disputes: {
    usage: "disputes [--watch]                     list disputes; --watch polls every 30s and timestamps new ones",
    run: async ([flag]) => {
      const list = async () => (await paypalRequest<{ items?: Dispute[] }>("/v1/customer/disputes?page_size=50")).items ?? [];
      const show = (d: Dispute) =>
        console.log(`  ${d.dispute_id}  ${d.reason}  ${d.status}  ${d.dispute_life_cycle_stage ?? ""}  created ${d.create_time}`);

      const first = await list();
      console.log(`${first.length} dispute(s):`);
      first.forEach(show);
      if (first[0]) print("Same list through the toolkit (first page):", await runToolkitTool("list_disputes", {}));
      if (flag !== "--watch") return;

      const seen = new Set(first.map((d) => d.dispute_id));
      const startedAt = Date.now();
      console.log("\nWatching for new disputes (Ctrl+C to stop)…");
      for (;;) {
        await new Promise((r) => setTimeout(r, 30_000));
        const fresh = (await list()).filter((d) => !seen.has(d.dispute_id));
        const elapsed = Math.round((Date.now() - startedAt) / 60_000);
        if (!fresh.length) {
          console.log(`  ${new Date().toLocaleTimeString()} — nothing new (${elapsed} min)`);
          continue;
        }
        for (const d of fresh) {
          seen.add(d.dispute_id);
          console.log(`  ★ NEW after ~${elapsed} min of watching:`);
          show(d);
        }
      }
    },
  },

  dispute: {
    usage: "dispute <disputeId>                    full dispute details (toolkit) + what the seller is allowed to do now",
    run: async ([disputeId]) => {
      const id = need(disputeId, "disputeId");
      print("Toolkit get_dispute:", await runToolkitTool("get_dispute", { dispute_id: id }));
      // The toolkit result omits `links`, which is where PayPal lists the actions open to the seller.
      await printSellerActions(id);
    },
  },

  evidence: {
    usage:
      'evidence <disputeId> <type> "<notes>" [carrier trackingNo]   submit evidence; PROOF_OF_FULFILLMENT takes carrier + tracking (direct REST)',
    run: async ([disputeId, evidenceType = "OTHER", notes, carrier, trackingNumber]) => {
      const evidence: Record<string, unknown> = { evidence_type: evidenceType, notes: need(notes, "notes") };
      if (evidenceType === "PROOF_OF_FULFILLMENT") {
        evidence.evidence_info = {
          tracking_info: [{ carrier_name: need(carrier, "carrier"), tracking_number: need(trackingNumber, "trackingNo") }],
        };
      }
      const form = new FormData();
      form.append("input", new Blob([JSON.stringify({ evidences: [evidence] })], { type: "application/json" }));
      const result = await paypalRequest(`/v1/customer/disputes/${need(disputeId, "disputeId")}/provide-evidence`, {
        method: "POST",
        body: form,
      });
      print("provide-evidence response:", result);
      await printSellerActions(disputeId);
    },
  },

  "send-message": {
    usage: 'send-message <disputeId> "<text>"     message the buyer inside the PayPal case (direct REST)',
    run: async ([disputeId, text]) => {
      const result = await paypalRequest(`/v1/customer/disputes/${need(disputeId, "disputeId")}/send-message`, {
        method: "POST",
        body: { message: need(text, "text") },
      });
      print("send-message response:", result);
      await printSellerActions(disputeId);
    },
  },

  "make-offer": {
    usage:
      'make-offer <disputeId> <type> <amount> "<note>"   offer to resolve: REFUND | REFUND_WITH_RETURN | REFUND_WITH_REPLACEMENT | REPLACEMENT_WITHOUT_REFUND (direct REST)',
    run: async ([disputeId, offerType, amount, note]) => {
      const result = await paypalRequest(`/v1/customer/disputes/${need(disputeId, "disputeId")}/make-offer`, {
        method: "POST",
        body: {
          note: need(note, "note"),
          offer_type: need(offerType, "type"),
          offer_amount: { currency_code: "USD", value: Number(need(amount, "amount")).toFixed(2) },
        },
      });
      print("make-offer response:", result);
      await printSellerActions(disputeId);
    },
  },
};

/** Prints the case's stage, state and the actions PayPal currently allows the seller. */
async function printSellerActions(disputeId: string) {
  const raw = await paypalRequest<Dispute & { dispute_state?: string; links?: Link[] }>(`/v1/customer/disputes/${disputeId}`);
  const actions = (raw.links ?? []).map((l) => l.rel).filter((rel) => rel !== "self");
  console.log(`\nStage ${raw.dispute_life_cycle_stage} · state ${raw.dispute_state}`);
  console.log(actions.length ? `Seller can now: ${actions.join(", ")}` : "Seller can't act right now (view only).");
}

async function main() {
  const [name, ...args] = process.argv.slice(2);
  const command = commands[name ?? ""];
  if (!command) {
    console.log("Usage: npm run paypal:spike -- <command>\n");
    for (const c of Object.values(commands)) console.log(`  ${c.usage}`);
    return;
  }
  await command.run(args);
}

main().catch((err) => {
  if (err instanceof PayPalError) print(err.message, err.body);
  else if (err instanceof ToolkitError) print(`PayPal toolkit ${err.tool} failed:`, err.detail);
  else console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
