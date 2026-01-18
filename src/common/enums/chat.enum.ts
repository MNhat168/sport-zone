export enum MessageType {
  TEXT = 'text',
  IMAGE = 'image',
  FILE = 'file',
  SYSTEM = 'system',
  FIELD_SUGGESTION = 'field_suggestion', // Suggest a field/court for match
  TIME_SUGGESTION = 'time_suggestion', // Suggest a time for match
  POLL = 'poll', // Poll for group decisions
  MATCH_NOTIFICATION = 'match_notification', // New match notification
  MATCH_PROPOSAL = 'match_proposal', // Match booking proposal with split payment
}

export enum ChatStatus {
  ACTIVE = 'active',
  RESOLVED = 'resolved',
  ARCHIVED = 'archived',
}
