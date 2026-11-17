import type { Metadata } from "next";
import { Sparkles } from "lucide-react";
import AccessDenied from "@/components/AccessDenied";
import { EmptyState, PageHeader } from "@/components/ui";
import { canViewPage, getMyPermissions } from "@/lib/permissions";
import { isAiConfigured } from "@/lib/ai/config";
import AssistantChat from "@/app/(app)/ai-assistant/AssistantChat";

export const metadata: Metadata = {
  title: "AI Assistant",
};

export default async function AiAssistantPage() {
  const permissions = await getMyPermissions();
  if (!canViewPage(permissions, "ai-assistant")) {
    return <AccessDenied />;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        icon={Sparkles}
        title="AI Assistant"
        description="Ask about sales, profit, stock, balances and warranties in English or Roman Urdu."
      />
      {isAiConfigured() ? (
        <AssistantChat />
      ) : (
        <EmptyState
          icon={Sparkles}
          title="AI Assistant is not configured yet"
          text="The owner needs to add an Anthropic API key (ANTHROPIC_API_KEY) to the server settings. Until then the assistant cannot answer questions."
        />
      )}
    </div>
  );
}
