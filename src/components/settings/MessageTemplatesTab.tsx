import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { logActivity } from "@/lib/activity";
import {
  BUILT_IN_TEMPLATES,
  EDITABLE_TEMPLATE_INFO,
  EDITABLE_TEMPLATE_KEYS,
  MESSAGE_TEMPLATES_QUERY_KEY,
  TEMPLATE_PLACEHOLDERS,
  resolveTemplate,
  useSavedTemplates,
  type EditableTemplateKey,
  type SavedTemplates,
} from "@/lib/message-templates";

type Change = { key: EditableTemplateKey; template: string | null };

function TemplateCard({
  templateKey,
  saved,
  disabled,
  saving,
  onSave,
}: {
  templateKey: EditableTemplateKey;
  saved: SavedTemplates | undefined;
  disabled: boolean;
  saving: boolean;
  onSave: (change: Change) => void;
}) {
  const current = resolveTemplate(templateKey, saved);
  const isCustom = Boolean(saved?.[templateKey]?.trim());
  const [value, setValue] = useState(current);
  const info = EDITABLE_TEMPLATE_INFO[templateKey];
  const inputId = `template-${templateKey}`;

  useEffect(() => {
    setValue(current);
  }, [current]);

  return (
    <Card className="border-border/60 bg-card/95">
      <CardContent className="space-y-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <label htmlFor={inputId} className="text-sm font-semibold text-foreground">{info.label}</label>
            <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{info.description}</p>
          </div>
          <Badge variant={isCustom ? "default" : "secondary"}>{isCustom ? "Edited" : "Built-in"}</Badge>
        </div>
        <Textarea id={inputId} value={value} onChange={(event) => setValue(event.target.value)} rows={12} disabled={disabled} />
        <p className="text-[11px] leading-5 text-muted-foreground">
          Placeholders: {TEMPLATE_PLACEHOLDERS[templateKey].map((name) => `{${name}}`).join(", ")}
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={disabled || saving || !isCustom}
            onClick={() => onSave({ key: templateKey, template: null })}
          >
            Reset to built-in
          </Button>
          <Button
            size="sm"
            disabled={disabled || saving || !value.trim() || value === current}
            onClick={() => onSave({ key: templateKey, template: value })}
          >
            {saving ? "Saving..." : "Save template"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Settings > Templates (admin only): edit the technician message and Check Template texts for every role. */
export default function MessageTemplatesTab() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: saved, isLoading, isError, error } = useSavedTemplates(true);

  const save = useMutation({
    mutationFn: async ({ key, template }: Change) => {
      const db = supabase.from("message_templates");
      const { error: saveError } = template === null
        ? await db.delete().eq("key", key)
        : await db.upsert({ key, template });
      if (saveError) throw new Error(saveError.message);
    },
    onSuccess: async (_data, { key, template }) => {
      const before = resolveTemplate(key, saved);
      await queryClient.invalidateQueries({ queryKey: MESSAGE_TEMPLATES_QUERY_KEY });
      toast.success(template === null ? "Template reset to built-in" : "Template saved");
      // The save already succeeded; a failed audit log must not report it as failed.
      if (user) {
        try {
          await logActivity(user.id, "updated", "message_template", key, {
            target_name: EDITABLE_TEMPLATE_INFO[key].label,
            changes: { template: { before, after: template ?? BUILT_IN_TEMPLATES[key] } },
            message: template === null
              ? `Admin reset the "${EDITABLE_TEMPLATE_INFO[key].label}" template to the built-in text.`
              : `Admin updated the "${EDITABLE_TEMPLATE_INFO[key].label}" template.`,
          });
        } catch {
          // Activity logging is best-effort here.
        }
      }
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : "Failed to save template"),
  });

  return (
    <div className="space-y-4">
      <p className="text-[12px] leading-5 text-muted-foreground">
        Changes here apply to every role. Edits made in a copy popup stay in that popup only.
      </p>
      {isError && (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
          Saved templates could not be loaded ({error instanceof Error ? error.message : "unknown error"}). The built-in texts are in use and editing is disabled until they load.
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {EDITABLE_TEMPLATE_KEYS.map((key) => (
          <TemplateCard
            key={key}
            templateKey={key}
            saved={saved}
            disabled={isLoading || isError}
            saving={save.isPending && save.variables?.key === key}
            onSave={(change) => save.mutate(change)}
          />
        ))}
      </div>
    </div>
  );
}
