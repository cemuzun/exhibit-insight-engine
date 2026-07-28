import { createFileRoute } from "@tanstack/react-router";
import { createEmailWebhookHandler } from "@lovable.dev/email-js";

/**
 * Delivery-outcome webhook. Lovable posts signed bounce / complaint /
 * unsubscribe / resubscribe events here and registers the hooks automatically
 * while this exact file path exists.
 */
const handler = createEmailWebhookHandler({
  apiKey: process.env.LOVABLE_API_KEY!,
  on: {
    "email.bounced": async (event) => {
      const { markRecipientSuppressed } = await import("@/lib/suppression.server");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await markRecipientSuppressed(supabaseAdmin as never, event.data.recipient, "bounced");
    },
    "email.complaint": async (event) => {
      const { markRecipientSuppressed } = await import("@/lib/suppression.server");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await markRecipientSuppressed(supabaseAdmin as never, event.data.recipient, "complained");
    },
    "email.unsubscribed": async (event) => {
      const { markRecipientSuppressed } = await import("@/lib/suppression.server");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await markRecipientSuppressed(supabaseAdmin as never, event.data.recipient, "unsubscribed");
    },
    "email.resubscribed": async (event) => {
      const { clearRecipientSuppression } = await import("@/lib/suppression.server");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await clearRecipientSuppression(supabaseAdmin as never, event.data.recipient);
    },
  },
});

export const Route = createFileRoute("/lovable/email/events")({
  server: {
    handlers: {
      POST: ({ request }) => handler(request),
    },
  },
});
