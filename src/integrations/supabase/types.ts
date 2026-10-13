export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      activity_logs: {
        Row: {
          action: string
          created_at: string | null
          details: string | null
          id: string
          target_id: string | null
          target_type: string
          user_id: string | null
          user_name: string
        }
        Insert: {
          action: string
          created_at?: string | null
          details?: string | null
          id?: string
          target_id?: string | null
          target_type: string
          user_id?: string | null
          user_name: string
        }
        Update: {
          action?: string
          created_at?: string | null
          details?: string | null
          id?: string
          target_id?: string | null
          target_type?: string
          user_id?: string | null
          user_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_status_refresh_runs: {
        Row: {
          id: boolean
          last_finished_at: string | null
          last_started_at: string | null
          last_summary: Json | null
          last_trigger: string | null
        }
        Insert: {
          id?: boolean
          last_finished_at?: string | null
          last_started_at?: string | null
          last_summary?: Json | null
          last_trigger?: string | null
        }
        Update: {
          id?: boolean
          last_finished_at?: string | null
          last_started_at?: string | null
          last_summary?: Json | null
          last_trigger?: string | null
        }
        Relationships: []
      }
      calls: {
        Row: {
          call_date: string
          created_at: string
          created_by: string
          customer_message: string | null
          direction: string
          flag: string
          handled_by: string | null
          id: string
          linked_lead_id: string | null
          notes: string | null
          number_name: string
          updated_at: string
        }
        Insert: {
          call_date?: string
          created_at?: string
          created_by: string
          customer_message?: string | null
          direction: string
          flag?: string
          handled_by?: string | null
          id?: string
          linked_lead_id?: string | null
          notes?: string | null
          number_name: string
          updated_at?: string
        }
        Update: {
          call_date?: string
          created_at?: string
          created_by?: string
          customer_message?: string | null
          direction?: string
          flag?: string
          handled_by?: string | null
          id?: string
          linked_lead_id?: string | null
          notes?: string | null
          number_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      copilot_config: {
        Row: {
          ai_enabled: boolean
          daily_ai_limit: number
          enabled: boolean
          id: boolean
          monthly_budget_cents: number
          timezone: string
        }
        Insert: {
          ai_enabled?: boolean
          daily_ai_limit?: number
          enabled?: boolean
          id?: boolean
          monthly_budget_cents?: number
          timezone?: string
        }
        Update: {
          ai_enabled?: boolean
          daily_ai_limit?: number
          enabled?: boolean
          id?: boolean
          monthly_budget_cents?: number
          timezone?: string
        }
        Relationships: []
      }
      copilot_role_permissions: {
        Row: {
          allowed: boolean
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          allowed?: boolean
          role: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          allowed?: boolean
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: []
      }
      copilot_user_permissions: {
        Row: {
          allowed: boolean
          user_id: string
        }
        Insert: {
          allowed: boolean
          user_id: string
        }
        Update: {
          allowed?: boolean
          user_id?: string
        }
        Relationships: []
      }
      crm_update_receipts: {
        Row: {
          acknowledged_at: string
          id: string
          notification_id: string
          user_id: string
        }
        Insert: {
          acknowledged_at?: string
          id?: string
          notification_id: string
          user_id: string
        }
        Update: {
          acknowledged_at?: string
          id?: string
          notification_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_update_receipts_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "crm_updates"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_updates: {
        Row: {
          affected_section: string
          created_at: string
          created_by: string | null
          description: string
          id: string
          is_active: boolean
          priority: string
          published_at: string
          target_roles: string[]
          title: string
          updated_at: string
        }
        Insert: {
          affected_section: string
          created_at?: string
          created_by?: string | null
          description: string
          id?: string
          is_active?: boolean
          priority?: string
          published_at?: string
          target_roles: string[]
          title: string
          updated_at?: string
        }
        Update: {
          affected_section?: string
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          is_active?: boolean
          priority?: string
          published_at?: string
          target_roles?: string[]
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      google_sheets_sync_errors: {
        Row: {
          action: string
          detail: Json | null
          id: number
          lead_id: string | null
          message: string
          occurred_at: string
        }
        Insert: {
          action?: string
          detail?: Json | null
          id?: number
          lead_id?: string | null
          message: string
          occurred_at?: string
        }
        Update: {
          action?: string
          detail?: Json | null
          id?: number
          lead_id?: string | null
          message?: string
          occurred_at?: string
        }
        Relationships: []
      }
      google_sheets_sync_health: {
        Row: {
          consecutive_failures: number
          id: string
          last_attempt_at: string | null
          last_error_at: string | null
          last_error_message: string | null
          last_success_at: string | null
          reconcile_active: boolean
          reconcile_clear_pending: boolean
          reconcile_lock_token: string | null
          reconcile_lock_until: string | null
          status: string
          synced_total: number
          updated_at: string
          watermark_at: string | null
        }
        Insert: {
          consecutive_failures?: number
          id?: string
          last_attempt_at?: string | null
          last_error_at?: string | null
          last_error_message?: string | null
          last_success_at?: string | null
          reconcile_active?: boolean
          reconcile_clear_pending?: boolean
          reconcile_lock_token?: string | null
          reconcile_lock_until?: string | null
          status?: string
          synced_total?: number
          updated_at?: string
          watermark_at?: string | null
        }
        Update: {
          consecutive_failures?: number
          id?: string
          last_attempt_at?: string | null
          last_error_at?: string | null
          last_error_message?: string | null
          last_success_at?: string | null
          reconcile_active?: boolean
          reconcile_clear_pending?: boolean
          reconcile_lock_token?: string | null
          reconcile_lock_until?: string | null
          status?: string
          synced_total?: number
          updated_at?: string
          watermark_at?: string | null
        }
        Relationships: []
      }
      google_sheets_sync_queue: {
        Row: {
          attempts: number
          enqueued_at: string
          generation: number
          job_id: string | null
          last_error: string | null
          lead_id: string
          lease_token: string | null
          lease_until: string | null
          next_attempt_at: string
          op: string
          previous_statuses: string[]
          updated_at: string
        }
        Insert: {
          attempts?: number
          enqueued_at?: string
          generation?: number
          job_id?: string | null
          last_error?: string | null
          lead_id: string
          lease_token?: string | null
          lease_until?: string | null
          next_attempt_at?: string
          op?: string
          previous_statuses?: string[]
          updated_at?: string
        }
        Update: {
          attempts?: number
          enqueued_at?: string
          generation?: number
          job_id?: string | null
          last_error?: string | null
          lead_id?: string
          lease_token?: string | null
          lease_until?: string | null
          next_attempt_at?: string
          op?: string
          previous_statuses?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      lead_ai_statuses: {
        Row: {
          checked_at: string
          last_message_at: string | null
          lead_id: string
          message_count: number
          model: string | null
          source: string
          status: string
        }
        Insert: {
          checked_at?: string
          last_message_at?: string | null
          lead_id: string
          message_count?: number
          model?: string | null
          source?: string
          status: string
        }
        Update: {
          checked_at?: string
          last_message_at?: string | null
          lead_id?: string
          message_count?: number
          model?: string | null
          source?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_ai_statuses_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_cancellation_requests: {
        Row: {
          ai_reason_applied: boolean
          ai_reason_code: string | null
          ai_suggested_at: string | null
          ai_suggested_reason: string | null
          comment: string
          created_at: string
          id: string
          lead_id: string
          previous_status: string
          proof: string | null
          proof_image_path: string | null
          requested_by: string | null
          requested_by_name: string | null
          requested_by_role: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          reviewed_by_name: string | null
          status: string
          updated_at: string
        }
        Insert: {
          ai_reason_applied?: boolean
          ai_reason_code?: string | null
          ai_suggested_at?: string | null
          ai_suggested_reason?: string | null
          comment: string
          created_at?: string
          id?: string
          lead_id: string
          previous_status: string
          proof?: string | null
          proof_image_path?: string | null
          requested_by?: string | null
          requested_by_name?: string | null
          requested_by_role: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewed_by_name?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          ai_reason_applied?: boolean
          ai_reason_code?: string | null
          ai_suggested_at?: string | null
          ai_suggested_reason?: string | null
          comment?: string
          created_at?: string
          id?: string
          lead_id?: string
          previous_status?: string
          proof?: string | null
          proof_image_path?: string | null
          requested_by?: string | null
          requested_by_name?: string | null
          requested_by_role?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewed_by_name?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_cancellation_requests_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_cancellation_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_cancellation_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_cancellation_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_cancellation_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_copy_role_permissions: {
        Row: {
          allowed: boolean
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          allowed?: boolean
          role: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          allowed?: boolean
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: []
      }
      lead_copy_user_permissions: {
        Row: {
          allowed: boolean
          user_id: string
        }
        Insert: {
          allowed: boolean
          user_id: string
        }
        Update: {
          allowed?: boolean
          user_id?: string
        }
        Relationships: []
      }
      lead_drafts: {
        Row: {
          draft_data: Json
          id: string
          lead_id: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          draft_data: Json
          id?: string
          lead_id?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          draft_data?: Json
          id?: string
          lead_id?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_drafts_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_hold_alerts: {
        Row: {
          created_at: string
          id: string
          lead_id: string
          read: boolean
          reason: string
          revision: string
          snapshot: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          lead_id: string
          read?: boolean
          reason: string
          revision?: string
          snapshot: Json
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          lead_id?: string
          read?: boolean
          reason?: string
          revision?: string
          snapshot?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_hold_alerts_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_notes: {
        Row: {
          content: string
          created_at: string | null
          id: string
          lead_id: string
          note_type: string
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          content: string
          created_at?: string | null
          id?: string
          lead_id: string
          note_type: string
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          content?: string
          created_at?: string | null
          id?: string
          lead_id?: string
          note_type?: string
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_notes_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_notes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_notes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_operator_assignments: {
        Row: {
          assigned_by: string | null
          assigned_by_name: string
          created_at: string | null
          id: string
          lead_id: string
          operator_user_id: string
        }
        Insert: {
          assigned_by?: string | null
          assigned_by_name?: string
          created_at?: string | null
          id?: string
          lead_id: string
          operator_user_id: string
        }
        Update: {
          assigned_by?: string | null
          assigned_by_name?: string
          created_at?: string | null
          id?: string
          lead_id?: string
          operator_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_operator_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_operator_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_operator_assignments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_operator_assignments_operator_user_id_fkey"
            columns: ["operator_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_operator_assignments_operator_user_id_fkey"
            columns: ["operator_user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_payment_requests: {
        Row: {
          amount: number
          comment: string | null
          created_at: string
          id: string
          lead_id: string
          previous_status: string
          requested_by: string | null
          requested_by_name: string | null
          requested_by_role: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          reviewed_by_name: string | null
          screenshot_path: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount: number
          comment?: string | null
          created_at?: string
          id?: string
          lead_id: string
          previous_status: string
          requested_by?: string | null
          requested_by_name?: string | null
          requested_by_role: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewed_by_name?: string | null
          screenshot_path?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          comment?: string | null
          created_at?: string
          id?: string
          lead_id?: string
          previous_status?: string
          requested_by?: string | null
          requested_by_name?: string | null
          requested_by_role?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewed_by_name?: string | null
          screenshot_path?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_payment_requests_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_payment_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_payment_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_payment_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_payment_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_payments: {
        Row: {
          amount: number | null
          created_at: string | null
          created_by: string | null
          created_by_name: string | null
          id: string
          lead_id: string
          screenshot_url: string | null
        }
        Insert: {
          amount?: number | null
          created_at?: string | null
          created_by?: string | null
          created_by_name?: string | null
          id?: string
          lead_id: string
          screenshot_url?: string | null
        }
        Update: {
          amount?: number | null
          created_at?: string | null
          created_by?: string | null
          created_by_name?: string | null
          id?: string
          lead_id?: string
          screenshot_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_payments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_payments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_payments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_photos: {
        Row: {
          created_at: string | null
          id: string
          lead_id: string
          photo_url: string
          uploaded_by: string | null
          uploaded_by_name: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          lead_id: string
          photo_url: string
          uploaded_by?: string | null
          uploaded_by_name?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          lead_id?: string
          photo_url?: string
          uploaded_by?: string | null
          uploaded_by_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_photos_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_photos_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_photos_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_quote_approval_requests: {
        Row: {
          created_at: string
          id: string
          lead_customer_name: string | null
          lead_id: string
          lead_job_id: string | null
          previous_status: string
          requested_by: string | null
          requested_by_name: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          reviewed_by_name: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          lead_customer_name?: string | null
          lead_id: string
          lead_job_id?: string | null
          previous_status: string
          requested_by?: string | null
          requested_by_name?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewed_by_name?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          lead_customer_name?: string | null
          lead_id?: string
          lead_job_id?: string | null
          previous_status?: string
          requested_by?: string | null
          requested_by_name?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewed_by_name?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_quote_approval_requests_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_quote_approval_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_quote_approval_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_quote_approval_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_quote_approval_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_shares: {
        Row: {
          created_at: string | null
          id: string
          lead_id: string
          shared_by: string
          shared_with_user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          lead_id: string
          shared_by: string
          shared_with_user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          lead_id?: string
          shared_by?: string
          shared_with_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_shares_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_status_visibility: {
        Row: {
          created_at: string
          id: string
          is_visible: boolean
          role: string | null
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_visible?: boolean
          role?: string | null
          status: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_visible?: boolean
          role?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_status_visibility_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_status_visibility_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_updates: {
        Row: {
          author_id: string | null
          author_name: string
          author_role: string
          content: string
          created_at: string | null
          id: string
          lead_id: string
        }
        Insert: {
          author_id?: string | null
          author_name: string
          author_role: string
          content: string
          created_at?: string | null
          id?: string
          lead_id: string
        }
        Update: {
          author_id?: string | null
          author_name?: string
          author_role?: string
          content?: string
          created_at?: string | null
          id?: string
          lead_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_updates_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_updates_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_updates_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_urgent_review_requests: {
        Row: {
          ai_checked_at: string | null
          ai_issues: Json
          ai_model: string | null
          ai_summary: string | null
          created_at: string
          id: string
          lead_customer_name: string | null
          lead_id: string
          lead_job_id: string | null
          previous_status: string
          requested_by: string | null
          requested_by_name: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          reviewed_by_name: string | null
          status: string
          updated_at: string
        }
        Insert: {
          ai_checked_at?: string | null
          ai_issues?: Json
          ai_model?: string | null
          ai_summary?: string | null
          created_at?: string
          id?: string
          lead_customer_name?: string | null
          lead_id: string
          lead_job_id?: string | null
          previous_status: string
          requested_by?: string | null
          requested_by_name?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewed_by_name?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          ai_checked_at?: string | null
          ai_issues?: Json
          ai_model?: string | null
          ai_summary?: string | null
          created_at?: string
          id?: string
          lead_customer_name?: string | null
          lead_id?: string
          lead_job_id?: string | null
          previous_status?: string
          requested_by?: string | null
          requested_by_name?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewed_by_name?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_urgent_review_requests_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          address: string | null
          amount: number | null
          assigned_cs: string | null
          booked_at: string | null
          cancellation_reason: string | null
          city: string | null
          coverage_area_label: string | null
          coverage_checked_at: string | null
          coverage_level: string | null
          coverage_tech_count: number | null
          created_at: string | null
          created_by: string | null
          created_by_name: string | null
          cs_notes: string | null
          cs_tag: string | null
          customer_email: string | null
          customer_landline: string | null
          customer_name: string
          customer_phone: string
          customer_schedule_requirements: string | null
          direction: string | null
          expected_completion_date: string | null
          for_us_amount: number | null
          for_you_amount: number | null
          general_notes: string | null
          half_address: string | null
          id: string
          job_id: string
          labor_amount: number | null
          last_edited_at: string | null
          last_edited_by: string | null
          last_edited_by_name: string | null
          latitude: number | null
          longitude: number | null
          manual_entry: boolean
          material_amount: number | null
          nearby_areas: Json | null
          number_name: string | null
          org_id: string
          payment_amount: number | null
          payment_screenshot_url: string | null
          processor_notes: string | null
          quote: string | null
          quote_requested_by: string | null
          reference_name: string | null
          scheduled_date: string | null
          scheduled_time_end: string | null
          scheduled_time_start: string | null
          service_details: string | null
          service_type: string
          show_quote_to_opr: boolean | null
          source_url: string | null
          state: string | null
          status: string
          tech_name: string | null
          tech_number: string | null
          terms: string | null
          updated_at: string | null
          urgent_at: string | null
          zip_code: string | null
        }
        Insert: {
          address?: string | null
          amount?: number | null
          assigned_cs?: string | null
          booked_at?: string | null
          cancellation_reason?: string | null
          city?: string | null
          coverage_area_label?: string | null
          coverage_checked_at?: string | null
          coverage_level?: string | null
          coverage_tech_count?: number | null
          created_at?: string | null
          created_by?: string | null
          created_by_name?: string | null
          cs_notes?: string | null
          cs_tag?: string | null
          customer_email?: string | null
          customer_landline?: string | null
          customer_name: string
          customer_phone: string
          customer_schedule_requirements?: string | null
          direction?: string | null
          expected_completion_date?: string | null
          for_us_amount?: number | null
          for_you_amount?: number | null
          general_notes?: string | null
          half_address?: string | null
          id?: string
          job_id: string
          labor_amount?: number | null
          last_edited_at?: string | null
          last_edited_by?: string | null
          last_edited_by_name?: string | null
          latitude?: number | null
          longitude?: number | null
          manual_entry?: boolean
          material_amount?: number | null
          nearby_areas?: Json | null
          number_name?: string | null
          org_id?: string
          payment_amount?: number | null
          payment_screenshot_url?: string | null
          processor_notes?: string | null
          quote?: string | null
          quote_requested_by?: string | null
          reference_name?: string | null
          scheduled_date?: string | null
          scheduled_time_end?: string | null
          scheduled_time_start?: string | null
          service_details?: string | null
          service_type: string
          show_quote_to_opr?: boolean | null
          source_url?: string | null
          state?: string | null
          status?: string
          tech_name?: string | null
          tech_number?: string | null
          terms?: string | null
          updated_at?: string | null
          urgent_at?: string | null
          zip_code?: string | null
        }
        Update: {
          address?: string | null
          amount?: number | null
          assigned_cs?: string | null
          booked_at?: string | null
          cancellation_reason?: string | null
          city?: string | null
          coverage_area_label?: string | null
          coverage_checked_at?: string | null
          coverage_level?: string | null
          coverage_tech_count?: number | null
          created_at?: string | null
          created_by?: string | null
          created_by_name?: string | null
          cs_notes?: string | null
          cs_tag?: string | null
          customer_email?: string | null
          customer_landline?: string | null
          customer_name?: string
          customer_phone?: string
          customer_schedule_requirements?: string | null
          direction?: string | null
          expected_completion_date?: string | null
          for_us_amount?: number | null
          for_you_amount?: number | null
          general_notes?: string | null
          half_address?: string | null
          id?: string
          job_id?: string
          labor_amount?: number | null
          last_edited_at?: string | null
          last_edited_by?: string | null
          last_edited_by_name?: string | null
          latitude?: number | null
          longitude?: number | null
          manual_entry?: boolean
          material_amount?: number | null
          nearby_areas?: Json | null
          number_name?: string | null
          org_id?: string
          payment_amount?: number | null
          payment_screenshot_url?: string | null
          processor_notes?: string | null
          quote?: string | null
          quote_requested_by?: string | null
          reference_name?: string | null
          scheduled_date?: string | null
          scheduled_time_end?: string | null
          scheduled_time_start?: string | null
          service_details?: string | null
          service_type?: string
          show_quote_to_opr?: boolean | null
          source_url?: string | null
          state?: string | null
          status?: string
          tech_name?: string | null
          tech_number?: string | null
          terms?: string | null
          updated_at?: string | null
          urgent_at?: string | null
          zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_assigned_cs_fkey"
            columns: ["assigned_cs"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_assigned_cs_fkey"
            columns: ["assigned_cs"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_last_edited_by_fkey"
            columns: ["last_edited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_last_edited_by_fkey"
            columns: ["last_edited_by"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_quote_requested_by_fkey"
            columns: ["quote_requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_quote_requested_by_fkey"
            columns: ["quote_requested_by"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      map_coverage_areas: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          latitude: number
          longitude: number
          name: string
          radius_miles: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          latitude: number
          longitude: number
          name?: string
          radius_miles: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          latitude?: number
          longitude?: number
          name?: string
          radius_miles?: number
          updated_at?: string
        }
        Relationships: []
      }
      navigation_permissions: {
        Row: {
          allowed: boolean | null
          id: string
          nav_section: string
          user_id: string
        }
        Insert: {
          allowed?: boolean | null
          id?: string
          nav_section: string
          user_id: string
        }
        Update: {
          allowed?: boolean | null
          id?: string
          nav_section?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string | null
          id: string
          lead_id: string | null
          message: string
          read: boolean
          title: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          lead_id?: string | null
          message: string
          read?: boolean
          title: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          lead_id?: string | null
          message?: string
          read?: boolean
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      optimized_areas: {
        Row: {
          city: string | null
          id: string
          is_active: boolean
          label: string
          marked_at: string
          marked_by: string | null
          note: string | null
          state: string | null
          zip_code: string | null
        }
        Insert: {
          city?: string | null
          id?: string
          is_active?: boolean
          label: string
          marked_at?: string
          marked_by?: string | null
          note?: string | null
          state?: string | null
          zip_code?: string | null
        }
        Update: {
          city?: string | null
          id?: string
          is_active?: boolean
          label?: string
          marked_at?: string
          marked_by?: string | null
          note?: string | null
          state?: string | null
          zip_code?: string | null
        }
        Relationships: []
      }
      organization_members: {
        Row: {
          created_at: string
          id: string
          org_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          role: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          logo_url: string | null
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          can_add_manual_leads: boolean
          can_manage_users: boolean | null
          can_view_tech_report: boolean
          created_at: string | null
          email: string
          full_name: string
          id: string
          is_quotation_master: boolean | null
          opr_code: string | null
        }
        Insert: {
          can_add_manual_leads?: boolean
          can_manage_users?: boolean | null
          can_view_tech_report?: boolean
          created_at?: string | null
          email: string
          full_name: string
          id: string
          is_quotation_master?: boolean | null
          opr_code?: string | null
        }
        Update: {
          can_add_manual_leads?: boolean
          can_manage_users?: boolean | null
          can_view_tech_report?: boolean
          created_at?: string | null
          email?: string
          full_name?: string
          id?: string
          is_quotation_master?: boolean | null
          opr_code?: string | null
        }
        Relationships: []
      }
      quo_ai_settings: {
        Row: {
          description: string | null
          id: string
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          description?: string | null
          id?: string
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          description?: string | null
          id?: string
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      quo_conversation_flags: {
        Row: {
          conversation_id: string
          created_at: string
          followed_up_at: string | null
          followed_up_by: string | null
          followed_up_by_name: string | null
          is_dead: boolean
          is_delayed: boolean
          is_important: boolean
          last_agent_reply_time: string | null
          last_customer_reply_time: string | null
          needs_follow_up: boolean
          reason: string | null
          response_delay: string | null
          rule_result: string | null
          suggested_action: string | null
          updated_at: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          followed_up_at?: string | null
          followed_up_by?: string | null
          followed_up_by_name?: string | null
          is_dead?: boolean
          is_delayed?: boolean
          is_important?: boolean
          last_agent_reply_time?: string | null
          last_customer_reply_time?: string | null
          needs_follow_up?: boolean
          reason?: string | null
          response_delay?: string | null
          rule_result?: string | null
          suggested_action?: string | null
          updated_at?: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          followed_up_at?: string | null
          followed_up_by?: string | null
          followed_up_by_name?: string | null
          is_dead?: boolean
          is_delayed?: boolean
          is_important?: boolean
          last_agent_reply_time?: string | null
          last_customer_reply_time?: string | null
          needs_follow_up?: boolean
          reason?: string | null
          response_delay?: string | null
          rule_result?: string | null
          suggested_action?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quo_conversation_flags_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: true
            referencedRelation: "quo_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      quo_conversations: {
        Row: {
          ai_tags: string[]
          created_at: string
          current_ai_section: string
          current_priority: string
          current_status: string
          customer_name: string | null
          customer_number: string | null
          direction: string | null
          id: string
          last_agent_message_at: string | null
          last_ai_analyzed_at: string | null
          last_customer_message_at: string | null
          last_message_at: string | null
          last_message_preview: string | null
          last_message_time: string | null
          linked_lead_id: string | null
          number_id: string | null
          quo_conversation_id: string
          raw_payload: Json | null
          rolling_ai_summary: string | null
          status: string | null
          updated_at: string
        }
        Insert: {
          ai_tags?: string[]
          created_at?: string
          current_ai_section?: string
          current_priority?: string
          current_status?: string
          customer_name?: string | null
          customer_number?: string | null
          direction?: string | null
          id?: string
          last_agent_message_at?: string | null
          last_ai_analyzed_at?: string | null
          last_customer_message_at?: string | null
          last_message_at?: string | null
          last_message_preview?: string | null
          last_message_time?: string | null
          linked_lead_id?: string | null
          number_id?: string | null
          quo_conversation_id: string
          raw_payload?: Json | null
          rolling_ai_summary?: string | null
          status?: string | null
          updated_at?: string
        }
        Update: {
          ai_tags?: string[]
          created_at?: string
          current_ai_section?: string
          current_priority?: string
          current_status?: string
          customer_name?: string | null
          customer_number?: string | null
          direction?: string | null
          id?: string
          last_agent_message_at?: string | null
          last_ai_analyzed_at?: string | null
          last_customer_message_at?: string | null
          last_message_at?: string | null
          last_message_preview?: string | null
          last_message_time?: string | null
          linked_lead_id?: string | null
          number_id?: string | null
          quo_conversation_id?: string
          raw_payload?: Json | null
          rolling_ai_summary?: string | null
          status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quo_conversations_linked_lead_id_fkey"
            columns: ["linked_lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quo_conversations_number_id_fkey"
            columns: ["number_id"]
            isOneToOne: false
            referencedRelation: "quo_phone_numbers"
            referencedColumns: ["id"]
          },
        ]
      }
      quo_messages: {
        Row: {
          conversation_id: string | null
          created_at: string
          direction: string | null
          id: string
          inserted_at: string
          media: Json
          message_time: string | null
          quo_created_at: string | null
          quo_message_id: string
          raw_payload: Json | null
          recipients: Json
          sender: string
          status: string | null
          text: string | null
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          direction?: string | null
          id?: string
          inserted_at?: string
          media?: Json
          message_time?: string | null
          quo_created_at?: string | null
          quo_message_id: string
          raw_payload?: Json | null
          recipients?: Json
          sender: string
          status?: string | null
          text?: string | null
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          direction?: string | null
          id?: string
          inserted_at?: string
          media?: Json
          message_time?: string | null
          quo_created_at?: string | null
          quo_message_id?: string
          raw_payload?: Json | null
          recipients?: Json
          sender?: string
          status?: string | null
          text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quo_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "quo_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      quo_number_preferences: {
        Row: {
          created_at: string
          emoji: string
          hidden: boolean
          id: string
          label_override: string | null
          phone_number_id: string
          sort_order: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          emoji?: string
          hidden?: boolean
          id?: string
          label_override?: string | null
          phone_number_id: string
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          emoji?: string
          hidden?: boolean
          id?: string
          label_override?: string | null
          phone_number_id?: string
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quo_number_preferences_phone_number_id_fkey"
            columns: ["phone_number_id"]
            isOneToOne: true
            referencedRelation: "quo_phone_numbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quo_number_preferences_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quo_number_preferences_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      quo_outbound_messages: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          error: string | null
          id: string
          phone_number_id: string | null
          quo_message_id: string | null
          sent_at: string | null
          status: string
          to_number: string
          updated_at: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          phone_number_id?: string | null
          quo_message_id?: string | null
          sent_at?: string | null
          status?: string
          to_number: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          phone_number_id?: string | null
          quo_message_id?: string | null
          sent_at?: string | null
          status?: string
          to_number?: string
          updated_at?: string
        }
        Relationships: []
      }
      quo_phone_numbers: {
        Row: {
          active: boolean
          brand: string | null
          created_at: string
          display_number: string | null
          id: string
          label: string | null
          location: string | null
          name: string | null
          number: string
          quo_phone_number_id: string
          team: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          brand?: string | null
          created_at?: string
          display_number?: string | null
          id?: string
          label?: string | null
          location?: string | null
          name?: string | null
          number: string
          quo_phone_number_id: string
          team?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          brand?: string | null
          created_at?: string
          display_number?: string | null
          id?: string
          label?: string | null
          location?: string | null
          name?: string | null
          number?: string
          quo_phone_number_id?: string
          team?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      quo_pinned_conversations: {
        Row: {
          conversation_id: string
          created_at: string
          id: string
          pinned_by: string | null
          sort_order: number
        }
        Insert: {
          conversation_id: string
          created_at?: string
          id?: string
          pinned_by?: string | null
          sort_order?: number
        }
        Update: {
          conversation_id?: string
          created_at?: string
          id?: string
          pinned_by?: string | null
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "quo_pinned_conversations_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: true
            referencedRelation: "quo_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quo_pinned_conversations_pinned_by_fkey"
            columns: ["pinned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quo_pinned_conversations_pinned_by_fkey"
            columns: ["pinned_by"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      quo_sync_logs: {
        Row: {
          created_at: string
          details: Json | null
          id: string
          status: string
          sync_type: string
        }
        Insert: {
          created_at?: string
          details?: Json | null
          id?: string
          status: string
          sync_type: string
        }
        Update: {
          created_at?: string
          details?: Json | null
          id?: string
          status?: string
          sync_type?: string
        }
        Relationships: []
      }
      quo_webhook_events: {
        Row: {
          created_at: string
          error_message: string | null
          event_type: string | null
          id: string
          processed_at: string | null
          processing_status: string
          quo_conversation_id: string | null
          quo_event_id: string | null
          quo_message_id: string | null
          quo_phone_number_id: string | null
          raw_payload: Json
          received_at: string
          signature_verified: boolean
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          event_type?: string | null
          id?: string
          processed_at?: string | null
          processing_status?: string
          quo_conversation_id?: string | null
          quo_event_id?: string | null
          quo_message_id?: string | null
          quo_phone_number_id?: string | null
          raw_payload: Json
          received_at?: string
          signature_verified?: boolean
        }
        Update: {
          created_at?: string
          error_message?: string | null
          event_type?: string | null
          id?: string
          processed_at?: string | null
          processing_status?: string
          quo_conversation_id?: string | null
          quo_event_id?: string | null
          quo_message_id?: string | null
          quo_phone_number_id?: string | null
          raw_payload?: Json
          received_at?: string
          signature_verified?: boolean
        }
        Relationships: []
      }
      status_permissions: {
        Row: {
          allowed: boolean | null
          id: string
          status: string
          user_id: string
        }
        Insert: {
          allowed?: boolean | null
          id?: string
          status: string
          user_id: string
        }
        Update: {
          allowed?: boolean | null
          id?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      technician_area_coordinate_cache: {
        Row: {
          area: string
          area_key: string
          city: string | null
          latitude: number | null
          longitude: number | null
          resolved_at: string
          state_code: string | null
        }
        Insert: {
          area: string
          area_key: string
          city?: string | null
          latitude?: number | null
          longitude?: number | null
          resolved_at?: string
          state_code?: string | null
        }
        Update: {
          area?: string
          area_key?: string
          city?: string | null
          latitude?: number | null
          longitude?: number | null
          resolved_at?: string
          state_code?: string | null
        }
        Relationships: []
      }
      technician_change_requests: {
        Row: {
          change_type: string
          created_at: string
          id: string
          previous_value: boolean | null
          reason: string | null
          requested_by: string
          requested_by_name: string | null
          requested_value: boolean
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          reviewed_by_name: string | null
          status: string
          technician_id: string
          technician_name: string
          updated_at: string
        }
        Insert: {
          change_type: string
          created_at?: string
          id?: string
          previous_value?: boolean | null
          reason?: string | null
          requested_by: string
          requested_by_name?: string | null
          requested_value: boolean
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewed_by_name?: string | null
          status?: string
          technician_id: string
          technician_name: string
          updated_at?: string
        }
        Update: {
          change_type?: string
          created_at?: string
          id?: string
          previous_value?: boolean | null
          reason?: string | null
          requested_by?: string
          requested_by_name?: string | null
          requested_value?: boolean
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewed_by_name?: string | null
          status?: string
          technician_id?: string
          technician_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      technician_workflow_assessments: {
        Row: {
          ai_evidence: Json
          ai_recommendations: string[]
          ai_summary: string | null
          conversations_reviewed: number
          labels: string[]
          last_assessed_at: string | null
          messages_reviewed: number
          technician_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          ai_evidence?: Json
          ai_recommendations?: string[]
          ai_summary?: string | null
          conversations_reviewed?: number
          labels?: string[]
          last_assessed_at?: string | null
          messages_reviewed?: number
          technician_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          ai_evidence?: Json
          ai_recommendations?: string[]
          ai_summary?: string | null
          conversations_reviewed?: number
          labels?: string[]
          last_assessed_at?: string | null
          messages_reviewed?: number
          technician_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "technician_workflow_assessments_technician_id_fkey"
            columns: ["technician_id"]
            isOneToOne: true
            referencedRelation: "technicians"
            referencedColumns: ["id"]
          },
        ]
      }
      technicians: {
        Row: {
          area: string
          chat_link: string | null
          code: string | null
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          is_good_tech: boolean | null
          latitude: number | null
          longitude: number | null
          name: string
          notes: string | null
          opr_code: string | null
          phone_number: string | null
          service: string | null
          updated_at: string
        }
        Insert: {
          area: string
          chat_link?: string | null
          code?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          is_good_tech?: boolean | null
          latitude?: number | null
          longitude?: number | null
          name: string
          notes?: string | null
          opr_code?: string | null
          phone_number?: string | null
          service?: string | null
          updated_at?: string
        }
        Update: {
          area?: string
          chat_link?: string | null
          code?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          is_good_tech?: boolean | null
          latitude?: number | null
          longitude?: number | null
          name?: string
          notes?: string | null
          opr_code?: string | null
          phone_number?: string | null
          service?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      us_places: {
        Row: {
          geography_vintage: number | null
          geoid: string
          latitude: number
          longitude: number
          name: string
          population: number
          population_vintage: number | null
          state_code: string
          state_name: string | null
          updated_at: string
        }
        Insert: {
          geography_vintage?: number | null
          geoid: string
          latitude: number
          longitude: number
          name: string
          population?: number
          population_vintage?: number | null
          state_code: string
          state_name?: string | null
          updated_at?: string
        }
        Update: {
          geography_vintage?: number | null
          geoid?: string
          latitude?: number
          longitude?: number
          name?: string
          population?: number
          population_vintage?: number | null
          state_code?: string
          state_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      user_access_codes: {
        Row: {
          code: string
          created_at: string | null
          id: string
          user_id: string
        }
        Insert: {
          code: string
          created_at?: string | null
          id?: string
          user_id: string
        }
        Update: {
          code?: string
          created_at?: string | null
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      user_notepads: {
        Row: {
          content: string
          created_at: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content?: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_status_change_permissions: {
        Row: {
          allowed_statuses: string[]
          created_at: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          allowed_statuses?: string[]
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          allowed_statuses?: string[]
          created_at?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      profiles_public: {
        Row: {
          full_name: string | null
          id: string | null
        }
        Insert: {
          full_name?: string | null
          id?: string | null
        }
        Update: {
          full_name?: string | null
          id?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      acknowledge_operator_hold_alert: {
        Args: { p_alerts: Json; p_id: string; p_revision: string }
        Returns: number
      }
      advance_sheets_sync_watermark: { Args: never; Returns: string }
      apply_urgent_form_fixes: {
        Args: { p_fixes: Json; p_lead_id: string }
        Returns: Json
      }
      approve_urgent_acknowledgement: {
        Args: { p_lead_id: string; p_reason?: string }
        Returns: undefined
      }
      approve_urgent_verification: {
        Args: { p_ai_model?: string; p_ai_summary?: string; p_lead_id: string }
        Returns: undefined
      }
      area_leaderboard: {
        Args: { _limit?: number }
        Returns: {
          cancelled_count: number
          cities: string
          closed_count: number
          closed_rate_pct: number
          is_optimised: boolean
          last_closed_at: string
          scheduled_count: number
          state: string
          technicians: number
        }[]
      }
      area_performance: {
        Args: { _city?: string; _state?: string; _zip?: string }
        Returns: {
          area_label: string
          cancelled_count: number
          closed_rate_pct: number
          last_paid_at: string
          paid_count: number
          scheduled_count: number
          technicians: number
        }[]
      }
      assert_urgent_required_data: {
        Args: { p_lead_id: string }
        Returns: undefined
      }
      assign_next_opr_code: { Args: { _user_id: string }; Returns: string }
      begin_google_sheets_full_reconcile: {
        Args: never
        Returns: {
          lock_token: string
          queued: number
        }[]
      }
      calculate_lead_technician_coverage: {
        Args: {
          _address: string
          _city: string
          _latitude: number
          _longitude: number
          _state: string
          _zip: string
        }
        Returns: {
          area_label: string
          tech_count: number
        }[]
      }
      can_access_quo_ai: { Args: never; Returns: boolean }
      can_access_quote_approval: { Args: never; Returns: boolean }
      can_create_manual_lead: { Args: never; Returns: boolean }
      can_manage_map_coverage: { Args: { _user_id: string }; Returns: boolean }
      can_use_quick_chat: { Args: { _user_id: string }; Returns: boolean }
      claim_ai_status_refresh: {
        Args: { p_cooldown_seconds?: number; p_trigger: string }
        Returns: boolean
      }
      claim_sheets_sync_queue: {
        Args: { p_limit?: number }
        Returns: {
          attempts: number
          generation: number
          job_id: string
          lead_id: string
          lease_token: string
          op: string
          previous_statuses: string[]
        }[]
      }
      compute_all_lead_coverage: {
        Args: never
        Returns: {
          bad: number
          checked: number
          good: number
          normal: number
          unlocated: number
        }[]
      }
      copilot_caller_role: { Args: never; Returns: string }
      copilot_configure: {
        Args: {
          p_ai_enabled: boolean
          p_daily_ai_limit: number
          p_enabled: boolean
          p_monthly_budget_cents: number
          p_timezone: string
        }
        Returns: undefined
      }
      copilot_finish_ai: {
        Args: {
          p_input: number
          p_output: number
          p_request_id: string
          p_success: boolean
        }
        Returns: undefined
      }
      copilot_get_access: { Args: never; Returns: Json }
      copilot_get_settings: { Args: never; Returns: Json }
      copilot_health: { Args: never; Returns: Json }
      copilot_nav_allowed: { Args: { p_section: string }; Returns: boolean }
      copilot_report: {
        Args: { p_end: string; p_scope?: string; p_start: string }
        Returns: Json
      }
      copilot_require_access: {
        Args: { p_section?: string }
        Returns: undefined
      }
      copilot_reserve_ai: {
        Args: { p_request_id: string; p_user_id: string }
        Returns: undefined
      }
      copilot_search: {
        Args: {
          p_active?: boolean
          p_area?: string
          p_date?: string
          p_kind: string
          p_offset?: number
          p_query?: string
          p_service?: string
          p_status?: string
        }
        Returns: Json
      }
      copilot_set_permission: {
        Args: {
          p_allowed: boolean
          p_role: Database["public"]["Enums"]["app_role"]
          p_user_id: string
        }
        Returns: undefined
      }
      copilot_status_visible: {
        Args: { p_status: string; p_tag: string }
        Returns: boolean
      }
      copilot_usage_summary: { Args: never; Returns: Json }
      copilot_visible_statuses: { Args: never; Returns: string[] }
      cron_google_sheets_sync_worker: { Args: never; Returns: undefined }
      cron_quo_reconcile_sync: { Args: never; Returns: undefined }
      cron_quo_sync_contacts: { Args: never; Returns: undefined }
      cron_refresh_urgent_ai_status: { Args: never; Returns: undefined }
      current_user_opr_code: { Args: never; Returns: string }
      default_org_id: { Args: never; Returns: string }
      delete_lead_by_admin: { Args: { target_lead_id: string }; Returns: Json }
      dispatch_lead_status_notification: {
        Args: {
          p_lead_id: string
          p_message: string
          p_title: string
          p_user_ids: string[]
        }
        Returns: number
      }
      enqueue_google_sheets_sync: {
        Args: {
          p_job_id: string
          p_lead_id: string
          p_op: string
          p_previous_status?: string
        }
        Returns: undefined
      }
      finish_ai_status_refresh: {
        Args: { p_summary?: Json }
        Returns: undefined
      }
      finish_google_sheets_full_reconcile: {
        Args: { p_lock_token: string }
        Returns: boolean
      }
      finish_sheets_sync_job: {
        Args: {
          p_detail?: Json
          p_generation: number
          p_lead_id: string
          p_lease_token: string
          p_message?: string
          p_success: boolean
        }
        Returns: boolean
      }
      get_cs_missed_followup_count: {
        Args: { p_number_ids?: string[]; p_since?: string; p_until?: string }
        Returns: number
      }
      get_lead_copy_access: { Args: never; Returns: boolean }
      get_lead_copy_settings: { Args: never; Returns: Json }
      get_operator_hold_alerts: { Args: never; Returns: Json }
      get_opr_codes_summary: {
        Args: never
        Returns: {
          count: number
          opr_code: string
        }[]
      }
      get_sheets_sync_health: {
        Args: { p_stale_after_seconds?: number }
        Returns: {
          behind_seconds: number
          consecutive_failures: number
          failed_jobs: number
          last_attempt_at: string
          last_error_at: string
          last_error_message: string
          last_success_at: string
          leads_behind: number
          queue_depth: number
          queue_oldest_at: string
          queue_oldest_seconds: number
          recent_errors: Json
          seconds_since_success: number
          status: string
          synced_total: number
          watermark_at: string
        }[]
      }
      get_sheets_sync_queue_depth: { Args: never; Returns: number }
      get_top_nearby_populated_areas: {
        Args: { _latitude: number; _longitude: number }
        Returns: {
          distance_miles: number
          geoid: string
          latitude: number
          longitude: number
          name: string
          population: number
          state_code: string
          state_name: string
        }[]
      }
      get_users_totp_status: {
        Args: never
        Returns: {
          has_totp: boolean
          user_id: string
        }[]
      }
      has_role:
        | {
            Args: {
              _role: Database["public"]["Enums"]["app_role"]
              _user_id: string
            }
            Returns: boolean
          }
        | {
            Args: {
              _role: Database["public"]["Enums"]["app_role_old"]
              _user_id: string
            }
            Returns: boolean
          }
      haversine_miles: {
        Args: { _lat1: number; _lat2: number; _lng1: number; _lng2: number }
        Returns: number
      }
      healthcheck: { Args: never; Returns: Json }
      is_admin_user: { Args: { check_user_id: string }; Returns: boolean }
      is_assigned_opr_code: { Args: { _opr_code: string }; Returns: boolean }
      is_org_member: { Args: { _org_id: string }; Returns: boolean }
      lead_address_city: { Args: { _address: string }; Returns: string }
      lead_technician_coverage: {
        Args: { _lead_id: string }
        Returns: {
          area_label: string
          tech_count: number
        }[]
      }
      leads_owned_by_caller: {
        Args: { _lead: Database["public"]["Tables"]["leads"]["Row"] }
        Returns: boolean
      }
      list_cs_missed_followups: {
        Args: { p_number_ids?: string[]; p_since?: string; p_until?: string }
        Returns: {
          conversation_id: string
          customer_name: string
          customer_number: string
          is_new_lead: boolean
          last_agent_at: string
          last_customer_at: string
          number: string
          number_display: string
          number_id: string
          number_label: string
          number_name: string
          preview: string
          quo_conversation_id: string
          quo_phone_number_id: string
          triage_status: string
          type: string
          waited_minutes: number
        }[]
      }
      list_opr_codes: {
        Args: never
        Returns: {
          full_name: string
          opr_code: string
        }[]
      }
      list_technician_change_requests: {
        Args: { p_status?: string }
        Returns: {
          change_type: string
          created_at: string
          current_is_active: boolean
          current_is_good_tech: boolean
          id: string
          previous_value: boolean
          reason: string
          requested_by: string
          requested_by_name: string
          requested_value: boolean
          review_note: string
          reviewed_at: string
          reviewed_by_name: string
          status: string
          technician_id: string
          technician_name: string
        }[]
      }
      list_urgent_review_requests: {
        Args: { p_status?: string }
        Returns: {
          ai_issues: Json
          ai_model: string
          ai_summary: string
          created_at: string
          current_customer_schedule_requirements: string
          current_quote: string
          current_service_details: string
          current_status: string
          current_terms: string
          id: string
          lead_customer_name: string
          lead_id: string
          lead_job_id: string
          previous_status: string
          requested_by: string
          requested_by_name: string
          review_note: string
          reviewed_at: string
          reviewed_by_name: string
          status: string
        }[]
      }
      manual_lead_access: {
        Args: never
        Returns: {
          can_add_manual_leads: boolean
          user_id: string
        }[]
      }
      mark_cs_followup_handled: {
        Args: { p_conversation_id: string; p_handled?: boolean }
        Returns: undefined
      }
      optimized_areas_with_performance: {
        Args: never
        Returns: {
          cancelled_count: number
          city: string
          closed_rate_pct: number
          id: string
          is_active: boolean
          label: string
          marked_at: string
          note: string
          paid_count: number
          scheduled_count: number
          state: string
          technicians: number
          zip_code: string
        }[]
      }
      org_role: { Args: { _org_id: string }; Returns: string }
      parse_lead_location: {
        Args: { _address: string; _city: string; _state: string; _zip: string }
        Returns: {
          city: string
          state: string
          zip_code: string
        }[]
      }
      pending_technician_change_summary: {
        Args: never
        Returns: {
          change_types: string[]
          technician_id: string
          technician_name: string
        }[]
      }
      preview_lead_technician_coverage: {
        Args: {
          _address: string
          _city?: string
          _state?: string
          _zip?: string
        }
        Returns: {
          area_label: string
          tech_count: number
        }[]
      }
      preview_lead_technician_coverage_at_point: {
        Args: {
          _address: string
          _city: string
          _latitude: number
          _longitude: number
          _state: string
          _zip: string
        }
        Returns: {
          area_label: string
          tech_count: number
        }[]
      }
      prune_sheets_sync_errors: { Args: { p_keep?: number }; Returns: number }
      quo_conversation_counts_by_number: {
        Args: never
        Returns: {
          phone_number_id: string
          total: number
        }[]
      }
      raise_sheets_sync_stale_alert: {
        Args: { p_stale_after_seconds?: number; p_throttle_minutes?: number }
        Returns: number
      }
      recalculate_all_lead_coverage: {
        Args: never
        Returns: {
          bad: number
          checked: number
          good: number
          normal: number
          unlocated: number
        }[]
      }
      recalculate_lead_coverage: { Args: { _lead_id: string }; Returns: string }
      record_quo_webhook_event: {
        Args: {
          _event_type: string
          _processing_status: string
          _quo_conversation_id: string
          _quo_event_id: string
          _quo_message_id: string
          _quo_phone_number_id: string
          _raw_payload: Json
          _signature_verified: boolean
        }
        Returns: string
      }
      record_sheets_sync_failure: {
        Args: {
          p_action?: string
          p_detail?: Json
          p_lead_id?: string
          p_message: string
        }
        Returns: undefined
      }
      record_sheets_sync_success: {
        Args: { p_lead_id?: string }
        Returns: undefined
      }
      refresh_lead_coverage: { Args: { _lead_id: string }; Returns: undefined }
      refresh_technician_area_coordinate_cache: { Args: never; Returns: number }
      request_quote_approval: { Args: { _lead_id: string }; Returns: string }
      request_technician_change: {
        Args: {
          p_change_type: string
          p_reason?: string
          p_requested_value: boolean
          p_technician_id: string
        }
        Returns: string
      }
      request_urgent_review: {
        Args: {
          p_ai_issues?: Json
          p_ai_model?: string
          p_ai_summary?: string
          p_lead_customer_name?: string
          p_lead_id: string
          p_lead_job_id?: string
          p_previous_status?: string
        }
        Returns: string
      }
      retry_sheets_sync_queue_now: {
        Args: { p_limit?: number }
        Returns: number
      }
      review_quote_approval_request: {
        Args: { _decision: string; _request_id: string; _review_note?: string }
        Returns: string
      }
      review_technician_change: {
        Args: { p_approve: boolean; p_note?: string; p_request_id: string }
        Returns: string
      }
      review_urgent_request: {
        Args: {
          p_approve: boolean
          p_request_id: string
          p_review_note?: string
        }
        Returns: string
      }
      search_technicians: {
        Args: { _limit: number; _offset: number; _q: string }
        Returns: {
          area: string
          chat_link: string
          id: string
          latitude: number
          longitude: number
          name: string
          notes: string
          phone_number: string
          service: string
          total_count: number
        }[]
      }
      set_can_add_manual_leads: {
        Args: { allowed: boolean; target_user_id: string }
        Returns: undefined
      }
      set_lead_copy_permission: {
        Args: {
          p_allowed: boolean
          p_role: Database["public"]["Enums"]["app_role"]
          p_user_id: string
        }
        Returns: undefined
      }
      sheets_sync_lag: {
        Args: never
        Returns: {
          behind_seconds: number
          leads_behind: number
          watermark_at: string
        }[]
      }
      tech_paid_performance: {
        Args: { _from?: string; _to?: string }
        Returns: {
          cancelled_count: number
          city: string
          good_tech: boolean
          last_paid_at: string
          location_label: string
          opr_code: string
          paid_count: number
          paid_rate_pct: number
          scheduled_count: number
          state: string
          tech_name: string
          zip_code: string
        }[]
      }
      technician_area_place: {
        Args: { _area: string }
        Returns: {
          city: string
          latitude: number
          longitude: number
          state_code: string
        }[]
      }
      urgent_required_missing: {
        Args: { p_lead_id: string }
        Returns: string[]
      }
      us_place_coordinates: {
        Args: { _city: string; _state?: string }
        Returns: {
          latitude: number
          longitude: number
        }[]
      }
      us_state_code: { Args: { _text: string }; Returns: string }
      withdraw_technician_change: {
        Args: { p_request_id: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role:
        | "admin"
        | "processor"
        | "customer_service"
        | "opr"
        | "cs_admin"
        | "opr_admin"
      app_role_old:
        | "admin"
        | "processor"
        | "customer_service"
        | "no_role"
        | "opr"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "admin",
        "processor",
        "customer_service",
        "opr",
        "cs_admin",
        "opr_admin",
      ],
      app_role_old: [
        "admin",
        "processor",
        "customer_service",
        "no_role",
        "opr",
      ],
    },
  },
} as const
