require("../config.js");
const {
  getContentType,
  areJidsSameUser,
  jidNormalizedUser,
  proto,
  jidDecode
} = require("baileys");

const serialize = async (conn, m) => {
  if (!m) return m;
  const { WebMessageInfo } = proto;

  if (m.key) {
    m.id = m.key.id;
    m.chat = /@s.whatsapp.net/.test(m.key.remoteJid) ? await conn.toLid(m.key.remoteJid) : m.key.remoteJid;
    m.isBaileys = m.id ? (m.id.startsWith("3EB0") || m.id.startsWith("B1E") || m.id.startsWith("BAE") || m.id.startsWith("3F8") || m.id.length < 32 || m.id.length == 18) : false;
    m.fromMe = m.key.fromMe;
    m.botNumber = conn.decodeJid(conn.user.id);
    let ownerNum = await conn.toLid(global.owner + "@s.whatsapp.net");
    m.isChannel = m.chat.endsWith("@newsletter");
    m.isGroup = m.chat.endsWith("@g.us");
    let sender = await conn.decodeJid(m.fromMe ? conn.user.id : (m.participant || m.key.participant || m.chat));
    m.sender = /@s.whatsapp.net/.test(sender) ? await conn.toLid(sender) : sender;
    m.isOwner = m.sender == m.botNumber || m.sender == ownerNum;
    if (m.isGroup) m.participant = m.key.participant && /@s.whatsapp.net/.test(m.key.participant) ? await conn.toLid(m.key.participant) : m.key.participant;
  }

  if (m.message) {
    m.mtype = await getContentType(m.message);
    m.prefix = ".";
    const content = m.message[m.mtype];
    m.msg = m.mtype === "viewOnceMessage" ? m.message[m.mtype].message[getContentType(m.message[m.mtype].message)] : content;
    m.body = m?.message?.conversation || m?.msg?.caption || m?.msg?.text || (m.mtype === "extendedTextMessage" && m.msg.text) || (m.mtype === "buttonsResponseMessage" && m.msg.selectedButtonId) || (m.mtype === "interactiveResponseMessage" && JSON.parse(m.msg.nativeFlowResponseMessage.paramsJson)?.id) || (m.mtype === "templateButtonReplyMessage" && m.msg.selectedId) || (m.mtype === "listResponseMessage" && m.msg.singleSelectReply?.selectedRowId) || "";
    const quotedMessage = (m.quoted = m.msg?.contextInfo?.quotedMessage || null);
    m.mentionedJid = m.msg?.contextInfo?.mentionedJid || [];

    if (quotedMessage) {
      let qType = getContentType(quotedMessage);
      m.quoted = quotedMessage[qType];
      if (qType === "productMessage") {
        qType = getContentType(m.quoted);
        m.quoted = m.quoted[qType];
      }
      if (typeof m.quoted === "string") m.quoted = { text: m.quoted };
      if (m.quoted) {
        m.quoted.key = {
          remoteJid: m.msg.contextInfo.remoteJid || m.from,
          participant: m.msg.contextInfo.participant && /@s.whatsapp.net/.test(m.msg.contextInfo.participant) ? await conn.toLid(m.msg.contextInfo.participant) : m.msg.contextInfo.participant,
          fromMe: areJidsSameUser(jidNormalizedUser(m.msg.contextInfo.participant), jidNormalizedUser(conn.user.id)),
          id: m.msg.contextInfo.stanzaId
        };
        m.quoted.mtype = qType;
        m.quoted.chat = /@s.whatsapp.net/.test(m.quoted.key.remoteJid) ? await conn.toLid(m.quoted.key.remoteJid) : m.quoted.key.remoteJid;
        m.quoted.id = m.quoted.key.id;
        m.quoted.isBaileys = m.quoted.id ? (m.quoted.id.startsWith("3EB0") || m.quoted.id.startsWith("B1E") || m.quoted.id.startsWith("3F8") || m.quoted.id.startsWith("BAE") || m.quoted.id.length < 32) : false;
        m.quoted.sender = await conn.decodeJid(m.quoted.key.participant);
        m.quoted.fromMe = m.quoted.sender === conn.user.id;
        m.quoted.text = m.quoted.text || m.quoted.caption || m.quoted.conversation || m.quoted.contentText || m.quoted.selectedDisplayText || m.quoted.title || "";
        m.quoted.mentionedJid = m.msg.contextInfo?.mentionedJid || [];
        const fakeObj = (m.quoted.fakeObj = WebMessageInfo.fromObject({
          key: m.quoted.key,
          message: quotedMessage,
          ...(m.isGroup ? { participant: m.quoted.sender } : {})
        }));
        m.quoted.download = (saveToFile = false) => conn.downloadMediaMessage(m.quoted, m.quoted.mtype.replace(/message/i, ""), saveToFile);
      }
    }
  }

  if (m.msg?.url) {
    m.download = (saveToFile = false) => conn.downloadMediaMessage(m.msg, m.mtype.replace(/message/i, ""), saveToFile);
  }

  m.text = m.body;
  m.reply = async (text, options = {}) => {
    const chatId = options.chat || m.chat;
    const quoted = options.quoted || m;
    const mentions = [...text.matchAll(/@(\d{0,19})/g)].map(v => v[1] + "@lid");
    return conn.sendMessage(chatId, { text, mentions, ...options }, { quoted });
  };

  return m;
};

function extendConn(conn) {
  if (!conn.toLid) {
    conn.toLid = async (jid) => {
      if (!jid) return jid;
      if (jid.includes('@lid')) return jid;
      let number = jid.split('@')[0];
      try {
        let [result] = await conn.query({
          tag: 'iq',
          attrs: { to: 's.whatsapp.net', type: 'get', xmlns: 'w:sync:app:state' },
          content: [{ tag: 'sync', attrs: {}, content: [{ tag: 'user', attrs: { jid: number + '@s.whatsapp.net' } }] }]
        });
        let lid = result?.content?.find(c => c.tag === 'sync')?.content?.find(c => c.tag === 'user')?.attrs?.lid;
        if (lid) return lid;
      } catch (e) {}
      return number + '@s.whatsapp.net';
    };
  }
  if (!conn.toPn) {
    conn.toPn = async (jid) => {
      if (!jid) return jid;
      if (jid.includes('@s.whatsapp.net')) return jid;
      if (!jid.includes('@lid')) return jid;
      try {
        let [result] = await conn.query({
          tag: 'iq',
          attrs: { to: 's.whatsapp.net', type: 'get', xmlns: 'w:sync:app:state' },
          content: [{ tag: 'sync', attrs: {}, content: [{ tag: 'user', attrs: { lid: jid } }] }]
        });
        let pn = result?.content?.find(c => c.tag === 'sync')?.content?.find(c => c.tag === 'user')?.attrs?.jid;
        if (pn) return pn;
      } catch (e) {}
      return jid;
    };
  }
  if (!conn.saveContact) {
    conn.saveContact = async (jid, name) => {
      try {
        let phoneNumber = jid.split('@')[0];
        if (!phoneNumber || isNaN(phoneNumber.replace(/\D/g, ''))) return false;
        const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:${name}\nTEL;waid=${phoneNumber}:${phoneNumber}\nEND:VCARD`;
        await conn.sendMessage(jid, {
          contacts: {
            displayName: name,
            contacts: [{ vcard }]
          }
        });
        return true;
      } catch (e) {
        return false;
      }
    };
  }
  if (!conn.decodeJid) {
    conn.decodeJid = (jid) => {
      if (!jid) return jid;
      if (/:\d+@/gi.test(jid)) {
        const decode = jidDecode(jid) || {};
        return decode.user && decode.server ? `${decode.user}@${decode.server}` : jid;
      }
      return jid;
    };
  }
}

module.exports = serialize;
module.exports.extendConn = extendConn;