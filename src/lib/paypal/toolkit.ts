/**
 * PayPal Agent Toolkit access.
 *
 * The toolkit is built on AI SDK v4 while the app uses v7, so its tools can't be
 * handed to the model directly. Instead we call each tool's `execute` from inside
 * our own v7 tools — which is also where the policy engine sits for money actions.
 */
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";

let toolkit: PayPalAgentToolkit | undefined;

function getToolkit(): PayPalAgentToolkit {
  if (toolkit) return toolkit;
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Missing PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET in .env");
  toolkit = new PayPalAgentToolkit({
    clientId,
    clientSecret,
    configuration: {
      actions: {
        orders: { get: true },
        payments: { createRefund: true, getRefunds: true },
        shipment: { create: true, get: true, update: true },
        disputes: { list: true, get: true, create: true }, // "create" enables accept_dispute_claim
        transactions: { list: true },
      },
      context: { sandbox: true },
    },
  });
  return toolkit;
}

export type ToolkitToolName =
  | "get_order"
  | "create_refund"
  | "get_refund"
  | "create_shipment_tracking"
  | "get_shipment_tracking"
  | "update_shipment_tracking"
  | "list_disputes"
  | "get_dispute"
  | "accept_dispute_claim"
  | "list_transactions";

export class ToolkitError extends Error {
  constructor(
    readonly tool: ToolkitToolName,
    readonly detail: unknown,
  ) {
    super(`PayPal toolkit ${tool} failed: ${JSON.stringify(detail)}`);
  }
}

/**
 * Runs one toolkit tool and returns its result, parsed from JSON when possible.
 * The toolkit reports failures as a normal `{ error: … }` result; we throw instead,
 * so a failed refund can never look like a successful one.
 */
export async function runToolkitTool(name: ToolkitToolName, input: Record<string, unknown>): Promise<unknown> {
  const tool = getToolkit().getTools()[name];
  if (!tool?.execute) throw new Error(`PayPal toolkit tool "${name}" is not enabled`);
  const parsed = tool.parameters.parse(input); // same validation the toolkit would apply
  let result: unknown = await tool.execute(parsed, { toolCallId: `firstreply-${name}`, messages: [] });
  if (typeof result === "string") {
    try {
      result = JSON.parse(result);
    } catch {
      // plain-text result; return as is
    }
  }
  if (result && typeof result === "object" && "error" in result) throw new ToolkitError(name, result.error);
  return result;
}
