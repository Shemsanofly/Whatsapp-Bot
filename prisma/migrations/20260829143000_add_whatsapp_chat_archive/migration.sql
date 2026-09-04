CREATE TABLE "WhatsAppChat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "remoteJid" TEXT NOT NULL,
    "displayName" TEXT,
    "isGroup" BOOLEAN NOT NULL DEFAULT false,
    "lastMessageAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "WhatsAppChatMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "externalId" TEXT,
    "chatId" TEXT NOT NULL,
    "remoteJid" TEXT NOT NULL,
    "participantJid" TEXT,
    "fromMe" BOOLEAN NOT NULL DEFAULT false,
    "text" TEXT NOT NULL,
    "messageAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WhatsAppChatMessage_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "WhatsAppChat" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "WhatsAppChat_remoteJid_key" ON "WhatsAppChat"("remoteJid");
CREATE INDEX "WhatsAppChat_lastMessageAt_idx" ON "WhatsAppChat"("lastMessageAt");
CREATE UNIQUE INDEX "WhatsAppChatMessage_externalId_key" ON "WhatsAppChatMessage"("externalId");
CREATE INDEX "WhatsAppChatMessage_remoteJid_messageAt_idx" ON "WhatsAppChatMessage"("remoteJid", "messageAt");
CREATE INDEX "WhatsAppChatMessage_chatId_messageAt_idx" ON "WhatsAppChatMessage"("chatId", "messageAt");
