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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      digest_schedules: {
        Row: {
          created_at: string
          days_of_week: number[]
          enabled: boolean
          hour_of_day: number
          id: string
          last_sent_at: string | null
          min_lead_score: number
          name: string
          only_tier_1: boolean
          recipient_email: string
          timezone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          days_of_week?: number[]
          enabled?: boolean
          hour_of_day?: number
          id?: string
          last_sent_at?: string | null
          min_lead_score?: number
          name?: string
          only_tier_1?: boolean
          recipient_email: string
          timezone?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          days_of_week?: number[]
          enabled?: boolean
          hour_of_day?: number
          id?: string
          last_sent_at?: string | null
          min_lead_score?: number
          name?: string
          only_tier_1?: boolean
          recipient_email?: string
          timezone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      email_templates: {
        Row: {
          body_template: string
          created_at: string
          id: string
          industry: string | null
          is_default: boolean
          min_evidence_level: string
          min_lead_score: number
          name: string
          subject_template: string
          trade_show: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          body_template?: string
          created_at?: string
          id?: string
          industry?: string | null
          is_default?: boolean
          min_evidence_level?: string
          min_lead_score?: number
          name: string
          subject_template?: string
          trade_show?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          body_template?: string
          created_at?: string
          id?: string
          industry?: string | null
          is_default?: boolean
          min_evidence_level?: string
          min_lead_score?: number
          name?: string
          subject_template?: string
          trade_show?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      events: {
        Row: {
          city: string | null
          country: string | null
          created_at: string
          days_until_event: number | null
          end_date: string | null
          event_name: string
          event_opportunity_score: number | null
          event_score: number | null
          event_score_breakdown: Json | null
          event_year: number | null
          excluded: boolean
          exclusion_reason: string | null
          exhibitor_directory_status: string
          extraction_metrics: Json | null
          id: string
          industry: string | null
          official_event_url: string | null
          official_url: string | null
          raw: Json | null
          recommended_outreach_phase: string | null
          run_id: string
          scoring_mode: string
          source_urls: string[]
          start_date: string | null
          state: string | null
          venue: string | null
          verification_checked_at: string | null
          verification_confidence: number | null
          verification_notes: string | null
          verification_source_urls: string[]
          verified_status: string
        }
        Insert: {
          city?: string | null
          country?: string | null
          created_at?: string
          days_until_event?: number | null
          end_date?: string | null
          event_name: string
          event_opportunity_score?: number | null
          event_score?: number | null
          event_score_breakdown?: Json | null
          event_year?: number | null
          excluded?: boolean
          exclusion_reason?: string | null
          exhibitor_directory_status?: string
          extraction_metrics?: Json | null
          id?: string
          industry?: string | null
          official_event_url?: string | null
          official_url?: string | null
          raw?: Json | null
          recommended_outreach_phase?: string | null
          run_id: string
          scoring_mode?: string
          source_urls?: string[]
          start_date?: string | null
          state?: string | null
          venue?: string | null
          verification_checked_at?: string | null
          verification_confidence?: number | null
          verification_notes?: string | null
          verification_source_urls?: string[]
          verified_status?: string
        }
        Update: {
          city?: string | null
          country?: string | null
          created_at?: string
          days_until_event?: number | null
          end_date?: string | null
          event_name?: string
          event_opportunity_score?: number | null
          event_score?: number | null
          event_score_breakdown?: Json | null
          event_year?: number | null
          excluded?: boolean
          exclusion_reason?: string | null
          exhibitor_directory_status?: string
          extraction_metrics?: Json | null
          id?: string
          industry?: string | null
          official_event_url?: string | null
          official_url?: string | null
          raw?: Json | null
          recommended_outreach_phase?: string | null
          run_id?: string
          scoring_mode?: string
          source_urls?: string[]
          start_date?: string | null
          state?: string | null
          venue?: string | null
          verification_checked_at?: string | null
          verification_confidence?: number | null
          verification_notes?: string | null
          verification_source_urls?: string[]
          verified_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "research_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      firecrawl_cache: {
        Row: {
          cache_key: string
          created_at: string
          expires_at: string
          kind: string
          request: Json
          response: Json
        }
        Insert: {
          cache_key: string
          created_at?: string
          expires_at: string
          kind: string
          request: Json
          response: Json
        }
        Update: {
          cache_key?: string
          created_at?: string
          expires_at?: string
          kind?: string
          request?: Json
          response?: Json
        }
        Relationships: []
      }
      leads: {
        Row: {
          account_key: string | null
          blocked_reasons: string[]
          booth_analysis_confidence: number | null
          booth_number: string | null
          booth_size_estimate: string | null
          booth_type: string | null
          budget_currency: string | null
          company_description: string | null
          company_name: string
          company_website: string | null
          confidence_level: string | null
          conflicts: Json | null
          country: string | null
          created_at: string
          crm_company_id: string | null
          crm_contact_ids: string[]
          crm_deal_id: string | null
          crm_error: string | null
          crm_status: string
          crm_synced_at: string | null
          decision_makers: Json
          displayed_company_name: string | null
          employee_range: string | null
          estimated_project_value_high: number | null
          estimated_project_value_low: number | null
          event_date: string | null
          event_id: string | null
          event_year: number | null
          evidence_hash: string | null
          evidence_locator: Json | null
          evidence_text: string | null
          exhibitor_instance_key: string | null
          extraction_confidence: number | null
          extraction_method: string | null
          found_at: string | null
          hall: string | null
          id: string
          industry: string | null
          last_confirmed_at: string | null
          lead_score: number
          linkedin_message: string | null
          normalized_company_name: string | null
          parent_company: string | null
          personalized_email: string | null
          priority_tier: string | null
          product_category: string | null
          profile_url: string | null
          raw: Json | null
          recommended_next_action: string | null
          recommended_outreach_date: string | null
          recommended_services: string[]
          record_status: string
          represented_brand: string | null
          revenue_range: string | null
          run_id: string
          score_breakdown: Json | null
          source_type: string | null
          source_urls: string[]
          sponsor_level: string | null
          trade_show: string | null
          unknown_fields: string[]
        }
        Insert: {
          account_key?: string | null
          blocked_reasons?: string[]
          booth_analysis_confidence?: number | null
          booth_number?: string | null
          booth_size_estimate?: string | null
          booth_type?: string | null
          budget_currency?: string | null
          company_description?: string | null
          company_name: string
          company_website?: string | null
          confidence_level?: string | null
          conflicts?: Json | null
          country?: string | null
          created_at?: string
          crm_company_id?: string | null
          crm_contact_ids?: string[]
          crm_deal_id?: string | null
          crm_error?: string | null
          crm_status?: string
          crm_synced_at?: string | null
          decision_makers?: Json
          displayed_company_name?: string | null
          employee_range?: string | null
          estimated_project_value_high?: number | null
          estimated_project_value_low?: number | null
          event_date?: string | null
          event_id?: string | null
          event_year?: number | null
          evidence_hash?: string | null
          evidence_locator?: Json | null
          evidence_text?: string | null
          exhibitor_instance_key?: string | null
          extraction_confidence?: number | null
          extraction_method?: string | null
          found_at?: string | null
          hall?: string | null
          id?: string
          industry?: string | null
          last_confirmed_at?: string | null
          lead_score?: number
          linkedin_message?: string | null
          normalized_company_name?: string | null
          parent_company?: string | null
          personalized_email?: string | null
          priority_tier?: string | null
          product_category?: string | null
          profile_url?: string | null
          raw?: Json | null
          recommended_next_action?: string | null
          recommended_outreach_date?: string | null
          recommended_services?: string[]
          record_status?: string
          represented_brand?: string | null
          revenue_range?: string | null
          run_id: string
          score_breakdown?: Json | null
          source_type?: string | null
          source_urls?: string[]
          sponsor_level?: string | null
          trade_show?: string | null
          unknown_fields?: string[]
        }
        Update: {
          account_key?: string | null
          blocked_reasons?: string[]
          booth_analysis_confidence?: number | null
          booth_number?: string | null
          booth_size_estimate?: string | null
          booth_type?: string | null
          budget_currency?: string | null
          company_description?: string | null
          company_name?: string
          company_website?: string | null
          confidence_level?: string | null
          conflicts?: Json | null
          country?: string | null
          created_at?: string
          crm_company_id?: string | null
          crm_contact_ids?: string[]
          crm_deal_id?: string | null
          crm_error?: string | null
          crm_status?: string
          crm_synced_at?: string | null
          decision_makers?: Json
          displayed_company_name?: string | null
          employee_range?: string | null
          estimated_project_value_high?: number | null
          estimated_project_value_low?: number | null
          event_date?: string | null
          event_id?: string | null
          event_year?: number | null
          evidence_hash?: string | null
          evidence_locator?: Json | null
          evidence_text?: string | null
          exhibitor_instance_key?: string | null
          extraction_confidence?: number | null
          extraction_method?: string | null
          found_at?: string | null
          hall?: string | null
          id?: string
          industry?: string | null
          last_confirmed_at?: string | null
          lead_score?: number
          linkedin_message?: string | null
          normalized_company_name?: string | null
          parent_company?: string | null
          personalized_email?: string | null
          priority_tier?: string | null
          product_category?: string | null
          profile_url?: string | null
          raw?: Json | null
          recommended_next_action?: string | null
          recommended_outreach_date?: string | null
          recommended_services?: string[]
          record_status?: string
          represented_brand?: string | null
          revenue_range?: string | null
          run_id?: string
          score_breakdown?: Json | null
          source_type?: string | null
          source_urls?: string[]
          sponsor_level?: string | null
          trade_show?: string | null
          unknown_fields?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "leads_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "research_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          email_status: string
          id: string
          last_step: string | null
          last_step_message: string | null
          read_at: string | null
          run_id: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          email_status?: string
          id?: string
          last_step?: string | null
          last_step_message?: string | null
          read_at?: string | null
          run_id?: string | null
          title: string
          type?: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          email_status?: string
          id?: string
          last_step?: string | null
          last_step_message?: string | null
          read_at?: string | null
          run_id?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "research_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_emails: {
        Row: {
          blocked_reasons: string[]
          body: string
          company_name: string
          created_at: string
          draft_status: string
          error: string | null
          follow_up_date: string | null
          id: string
          lead_id: string
          lead_score: number
          outreach_phase: string | null
          personalization_fact: Json | null
          priority_tier: string | null
          recipient_email: string
          recipient_name: string | null
          recipient_title: string | null
          recommended_send_date: string | null
          run_id: string
          sent_at: string | null
          service_offered: string | null
          status: string
          subject: string
          suppressed_at: string | null
          suppression_reason: string | null
          template_name: string | null
          updated_at: string
          user_id: string
          validation: Json | null
        }
        Insert: {
          blocked_reasons?: string[]
          body?: string
          company_name: string
          created_at?: string
          draft_status?: string
          error?: string | null
          follow_up_date?: string | null
          id?: string
          lead_id: string
          lead_score?: number
          outreach_phase?: string | null
          personalization_fact?: Json | null
          priority_tier?: string | null
          recipient_email: string
          recipient_name?: string | null
          recipient_title?: string | null
          recommended_send_date?: string | null
          run_id: string
          sent_at?: string | null
          service_offered?: string | null
          status?: string
          subject?: string
          suppressed_at?: string | null
          suppression_reason?: string | null
          template_name?: string | null
          updated_at?: string
          user_id: string
          validation?: Json | null
        }
        Update: {
          blocked_reasons?: string[]
          body?: string
          company_name?: string
          created_at?: string
          draft_status?: string
          error?: string | null
          follow_up_date?: string | null
          id?: string
          lead_id?: string
          lead_score?: number
          outreach_phase?: string | null
          personalization_fact?: Json | null
          priority_tier?: string | null
          recipient_email?: string
          recipient_name?: string | null
          recipient_title?: string | null
          recommended_send_date?: string | null
          run_id?: string
          sent_at?: string | null
          service_offered?: string | null
          status?: string
          subject?: string
          suppressed_at?: string | null
          suppression_reason?: string | null
          template_name?: string | null
          updated_at?: string
          user_id?: string
          validation?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "outreach_emails_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_emails_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "research_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
        }
        Relationships: []
      }
      research_runs: {
        Row: {
          completed_at: string | null
          counters: Json
          created_at: string
          error_message: string | null
          executive_summary: Json | null
          filters: Json
          id: string
          input_source_type: string
          input_url: string
          limitations: string[]
          progress_message: string | null
          stage: string | null
          status: string
          step_log: Json
          target_market: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          counters?: Json
          created_at?: string
          error_message?: string | null
          executive_summary?: Json | null
          filters?: Json
          id?: string
          input_source_type?: string
          input_url: string
          limitations?: string[]
          progress_message?: string | null
          stage?: string | null
          status?: string
          step_log?: Json
          target_market?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          counters?: Json
          created_at?: string
          error_message?: string | null
          executive_summary?: Json | null
          filters?: Json
          id?: string
          input_source_type?: string
          input_url?: string
          limitations?: string[]
          progress_message?: string | null
          stage?: string | null
          status?: string
          step_log?: Json
          target_market?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      scoring_settings: {
        Row: {
          created_at: string
          qualified_min: number
          tier1_min: number
          tier1_requires_verified_contact: boolean
          tier2_min: number
          tier3_min: number
          updated_at: string
          user_id: string
          weights: Json
        }
        Insert: {
          created_at?: string
          qualified_min?: number
          tier1_min?: number
          tier1_requires_verified_contact?: boolean
          tier2_min?: number
          tier3_min?: number
          updated_at?: string
          user_id: string
          weights?: Json
        }
        Update: {
          created_at?: string
          qualified_min?: number
          tier1_min?: number
          tier1_requires_verified_contact?: boolean
          tier2_min?: number
          tier3_min?: number
          updated_at?: string
          user_id?: string
          weights?: Json
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
