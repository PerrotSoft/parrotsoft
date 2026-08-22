// Реестр методов для Bot API и Client API Вавичата. Один реестр на оба —
// чтобы не дублировать диспетчер дважды, у каждого метода есть флаг surface:
//   'bot'    — доступен только через Bot API (обычно не нужен людям, только ботам)
//   'client' — доступен только через Client API (полное зеркало — управление чатом и т.д.)
//   'both'   — доступен в обоих
//
// $username в списке args — не берётся из присланных params (чтобы бот не
// мог прислать чужой username и притвориться другим отправителем/актёром),
// а подставляется сервером из уже проверенного логина (см. wavychatApiAuth.js).
//
// Формат вызова из route.js: callMethod(methodName, params, ctx, surface)

import {
  sendMsg, getMsgs, getMsgsPage, getMsgsSince, deleteMsgs,
  getMyChats, createChat, joinChat, leaveChatSmart, deleteChat, deleteChatCompletely,
  renameChat, updateChatIcon, checkChatAccess, updateChatPrivacy, updateChatPassword,
  searchGlobal, getChatMembers, kickUser, promoteUser,
  isChatAdmin, getChatAdmins, addChatAdmin, removeChatAdmin,
  markChatRead, getChatReadState,
  toggleReaction, getReactionsForChat,
  votePoll, getPollVotes,
  getLinkPreview,
  searchUsers, startDirectChat,
  getUserIcon, getUserIcons,
  setWcAvatar, getWcAvatar,
  joinCall, startCallNotification, endCallNotification, checkActiveCall,
} from '../actions';

// Небольшая обёртка, чтобы не плодить одинаковый try/catch в каждом методе —
// сам вызов остаётся объявлением "как собрать аргументы из params/ctx".
const m = (surface, fn, argBuilder) => ({ surface, fn, argBuilder });

export const METHODS = {
  // ── Сообщения ──────────────────────────────────────────────────────────
  // p.chatPassword — только для чатов с паролем (см. lib/msgCrypto.js):
  // сообщения там шифруются ключом из пароля чата, а не общим серверным
  // ключом, так что без него сообщение либо не отправится (sendMessage
  // проверяет пароль по хэшу), либо придёт нечитаемым (getMessages*).
  sendMessage: m('both', sendMsg, (p, ctx) => [p.chatId, ctx.username, p.text, p.media || null, p.chatPassword || null]),
  getMessages: m('both', getMsgs, (p) => [p.chatId, p.chatPassword || null]),
  getMessagesPage: m('both', getMsgsPage, (p) => [p.chatId, { limit: p.limit || 100, beforeId: p.beforeId || null }, p.chatPassword || null]),
  getMessagesSince: m('both', getMsgsSince, (p) => [p.chatId, p.afterId, p.chatPassword || null]),
  deleteMessages: m('client', deleteMsgs, (p) => [p.ids]),
  markChatRead: m('both', markChatRead, (p, ctx) => [p.chatId, ctx.username]),
  getChatReadState: m('both', getChatReadState, (p) => [p.chatId]),

  // ── Реакции и опросы ───────────────────────────────────────────────────
  toggleReaction: m('both', toggleReaction, (p, ctx) => [p.msgId, ctx.username, p.emoji]),
  getReactions: m('both', getReactionsForChat, (p) => [p.msgIds || []]),
  votePoll: m('both', votePoll, (p, ctx) => [p.msgId, ctx.username, p.optionIdx]),
  getPollVotes: m('both', getPollVotes, (p) => [p.msgId]),

  // ── Чаты ───────────────────────────────────────────────────────────────
  getMyChats: m('both', getMyChats, (p, ctx) => [ctx.username]),
  createChat: m('client', createChat, (p, ctx) => [p.title, ctx.username, p.type, p.privacy, p.icon || null, p.password || null]),
  joinChat: m('both', joinChat, (p, ctx) => [p.chatId, ctx.username]),
  leaveChat: m('both', leaveChatSmart, (p, ctx) => [p.chatId, ctx.username]),
  deleteChat: m('client', deleteChatCompletely, (p) => [p.chatId, p.chatPassword || null]),
  renameChat: m('client', renameChat, (p) => [p.chatId, p.newTitle]),
  updateChatIcon: m('client', updateChatIcon, (p) => [p.chatId, p.base64Data]),
  checkChatAccess: m('both', checkChatAccess, (p) => [p.chatId, p.password || null]),
  updateChatPrivacy: m('client', updateChatPrivacy, (p, ctx) => [p.chatId, ctx.username, p.privacy, p.password || null]),
  updateChatPassword: m('client', updateChatPassword, (p) => [p.chatId, p.newPassword]),
  searchChats: m('both', searchGlobal, (p) => [p.q]),
  getChatMembers: m('both', getChatMembers, (p) => [p.chatId]),
  kickUser: m('client', kickUser, (p) => [p.chatId, p.username]),
  promoteUser: m('client', promoteUser, (p) => [p.chatId, p.username]),
  isChatAdmin: m('client', isChatAdmin, (p) => [p.chat, p.username]),
  getChatAdmins: m('both', getChatAdmins, (p) => [p.chatId, p.ownerUsername]),
  addChatAdmin: m('client', addChatAdmin, (p, ctx) => [p.chatId, ctx.username, p.targetUsername, p.ownerUsername]),
  removeChatAdmin: m('client', removeChatAdmin, (p, ctx) => [p.chatId, ctx.username, p.targetUsername, p.ownerUsername]),

  // ── Пользователи ───────────────────────────────────────────────────────
  searchUsers: m('both', searchUsers, (p) => [p.query]),
  startDirectChat: m('both', startDirectChat, (p, ctx) => [ctx.username, p.targetUsername]),
  getUserIcon: m('both', getUserIcon, (p) => [p.username]),
  getUserIcons: m('both', getUserIcons, (p) => [p.usernames || []]),
  getMyAvatar: m('client', getWcAvatar, (p, ctx) => [ctx.username]),
  setMyAvatar: m('client', setWcAvatar, (p, ctx) => [ctx.username, p.dataUrl]),

  // ── Ссылки ─────────────────────────────────────────────────────────────
  getLinkPreview: m('both', getLinkPreview, (p) => [p.url]),

  // ── Звонки (базовое управление; сам медиа-поток звонка идёт мимо этого API) ─
  joinCall: m('client', joinCall, (p, ctx) => [p.chatId, ctx.username]),
  startCall: m('client', startCallNotification, (p, ctx) => [p.chatId, ctx.username]),
  endCall: m('client', endCallNotification, (p) => [p.chatId]),
  checkActiveCall: m('both', checkActiveCall, (p) => [p.chatId]),
};

// Собрать список методов, доступных для конкретной поверхности (используется
// и для проверки, и для self-documenting GET-ответа на /api/wavychat-bot и
// /api/wavychat-client — см. route.js).
export function methodsFor(surface) {
  return Object.entries(METHODS)
    .filter(([, def]) => def.surface === surface || def.surface === 'both')
    .map(([name]) => name);
}

export async function callMethod(methodName, params, ctx, surface) {
  const def = METHODS[methodName];
  if (!def) return { success: false, error: `Неизвестный метод: ${methodName}`, status: 404 };
  if (def.surface !== 'both' && def.surface !== surface) {
    return { success: false, error: `Метод "${methodName}" недоступен в этом API`, status: 403 };
  }
  try {
    const args = def.argBuilder(params || {}, ctx);
    const result = await def.fn(...args);
    // Многие функции в actions.js возвращают "голые" значения (массивы,
    // строки), а не { success }. Заворачиваем единообразно, чтобы клиенту
    // API не приходилось помнить, какой конкретно метод как отвечает.
    if (result && typeof result === 'object' && 'success' in result) {
      return { status: result.success ? 200 : 400, ...result };
    }
    return { status: 200, success: true, result };
  } catch (e) {
    return { success: false, error: e.message || String(e), status: 500 };
  }
}
