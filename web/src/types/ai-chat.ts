export interface AiChatMessage {
  id: number;
  conversation_id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface AiChatConversation {
  id: number;
  title: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  message_count?: number;
  messages?: AiChatMessage[];
}

export interface AiChatConversationListResponse {
  items: AiChatConversation[];
  total: number;
}

export interface AiChatMessageResponse {
  message: AiChatMessage;
  reply: AiChatMessage;
}
