// Mutation to update conversation Lead Status
  const updateStatusMutation = useMutation({
    mutationFn: async ({
      conversationId,
      newStatus,
    }: {
      conversationId: string;
      newStatus: QuoLeadStatus;
    }) => {
      const { error } = await supabase
        .from("quo_conversations")
        .update({
          status: newStatus,
          current_status: newStatus,
          updated_at: new Date().toISOString(),
        })
        .eq("id", conversationId);

      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.setQueryData<ConversationRow[]>(
        ["quo-dashboard-conversations"],
        (old = []) =>
          old.map((c) =>
            c.id === variables.conversationId
              ? { ...c, status: variables.newStatus, current_status: variables.newStatus }
              : c
          )
      );
      toast.success(`Lead status updated to ${QUO_LEAD_STATUS_CONFIG[variables.newStatus].label}`);
    },
    onError: (err: Error) => {
      toast.error(`Failed to update status: ${err.message}`);
    },
  });

  // Query Webhook Ingestion Paused Setting
  const { data: isWebhookPaused = false, refetch: refetchWebhookSetting } = useQuery<boolean>({
    queryKey: ["quo-webhook-paused-setting"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quo_ai_settings" as any)
        .select("value")
        .eq("key", "quo_webhook_ingestion_paused")
        .maybeSingle();

      if (error) return false;
      return (data as any)?.value === true;
    },
  });

  // Mutation to toggle Webhook Ingestion Paused state
  const toggleWebhookMutation = useMutation({
    mutationFn: async (shouldPause: boolean) => {
      const { error } = await supabase
        .from("quo_ai_settings" as any)
        .upsert(
          {
            key: "quo_webhook_ingestion_paused",
            value: shouldPause,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "key" }
        );

      if (error) throw error;
    },
    onSuccess: (_, shouldPause) => {
      refetchWebhookSetting();
      toast.success(
        shouldPause
          ? "QUO Webhook ingestion paused"
          : "QUO Webhook ingestion activated! Now receiving new messages."
      );
    },
    onError: (err: Error) => {
      toast.error(`Failed to toggle webhook setting: ${err.message}`);
    },
  });

  // Toggle selection for QUO Phone Numbers filter
  const handleToggleNumber = (id: string) => {
    setSelectedNumberIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSelectAllNumbers = () => {
    if (selectedNumberIds.length === phoneNumbers.length) {
      setSelectedNumberIds([]);
    } else {
      setSelectedNumberIds(phoneNumbers.map((n) => n.id));
    }
  };

