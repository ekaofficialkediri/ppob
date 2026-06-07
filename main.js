require("./Files/function.js");
require("./config.js");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
  DisconnectReason,
  jidDecode,
  downloadContentFromMessage,
} = require("baileys");

const chalk = require("chalk");
const Pino = require("pino");
const fs = require("fs");
const DataBase = require("./Files/database.js");
const database = new DataBase();
global.groupMetadataCache = new Map();
const serialize = require("./Files/serialize");
const { extendConn } = require("./Files/serialize"); // tambahan

const loadDb = async () => {
  const load = await database.read() || {};
  global.db = {
    users: load.users || {},
    groups: load.groups || {},
    settings: load.settings || {}
  };
  await database.write(global.db);
  setInterval(() => database.write(global.db), 2000);
};

loadDb();

// Variabel untuk scheduler (agar tidak double interval)
let autoJpmInterval = null;
let autoSwgcInterval = null;

function startAutoJpm(sock) {
  if (autoJpmInterval) clearInterval(autoJpmInterval);
  autoJpmInterval = setInterval(async () => {
    try {
      const setting = global.db?.settings?.autojpm;
      if (!setting || !setting.enabled) return;
      const now = Date.now();
      if (now - setting.lastRun >= setting.interval * 60000) {
        console.log('Menjalankan autojpm otomatis...');
        if (typeof global.kirimAutoJpm === 'function') {
          await global.kirimAutoJpm(sock);
        }
      }
    } catch (e) {
      console.error('Error autojpm interval:', e);
    }
  }, 60000);
}

function startAutoSwgc(sock) {
  if (autoSwgcInterval) clearInterval(autoSwgcInterval);
  autoSwgcInterval = setInterval(async () => {
    try {
      const setting = global.db?.settings?.autojpmswgc;
      if (!setting || !setting.enabled) return;
      const now = Date.now();
      if (now - setting.lastRun >= setting.interval * 60000) {
        console.log('Menjalankan autojpmswgc otomatis...');
        if (typeof global.kirimAutoSwgc === 'function') {
          await global.kirimAutoSwgc(sock);
        }
      }
    } catch (e) {
      console.error('Error autojpmswgc interval:', e);
    }
  }, 60000);
}

async function StartBot() {
  const { state, saveCreds } = await useMultiFileAuthState("./session");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    logger: Pino({ level: "silent" }),
    browser: Browsers.ubuntu("Safari"),
    auth: state,
    printQRInTerminal: false,
    syncFullHistory: false,
    cachedGroupMetadata: async (jid) => {
      if (!global.groupMetadataCache.has(jid)) {
        const metadata = await sock.groupMetadata(jid).catch(() => {});
        global.groupMetadataCache.set(jid, metadata);
        return metadata;
      }
      return global.groupMetadataCache.get(jid);
    }
  });
  global.sock = sock; // 🔥 tambahkan ini
  // Extend fungsi ke sock (toLid, saveContact, dll)
  extendConn(sock);

  // Fallback upload media jika tidak ada
  if (!sock.waUploadToServer) {
    sock.waUploadToServer = async (buffer, type) => {
      const url = await global.Telegraph(buffer);
      return { url: url };
    };
  }

  if (!sock.authState.creds.registered) {
    console.log(chalk.cyanBright("• Loading Code.."));
    setTimeout(async () => {
      const code = await sock.requestPairingCode(global.pairingNumber.trim(), "SCBYFYXZ");
      console.log(chalk.cyanBright("• Pair Code :"), chalk.magentaBright(code));
    }, 4000);
  }

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message) return;
    const m = await serialize(sock, msg);
    if (m.isBaileys) return;
    require("./Handle.js")(sock, m);
  });

  sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;
      if (reason !== DisconnectReason.loggedOut) {
        console.log("Reconnecting...");
        StartBot();
      } else {
        console.log(chalk.redBright("Connection Closed!! Hapus Folder/File Session Lalu Restart"));
      }
    }
    if (connection === "open") {
      console.log(chalk.greenBright("═══════════\n📦Bot Berhasil Terhubung √\n═══════════"));
      startAutoJpm(sock);
      startAutoSwgc(sock);
    }
  });

  sock.ev.on("group-participants.update", async (update) => {
    const { id, participants, action, author } = update;
    const groupMetadata = await sock.groupMetadata(id);
    global.groupMetadataCache.set(id, groupMetadata);
  });

  sock.downloadMediaMessage = async (m, type, filename = "") => {
    if (!m || !(m.url || m.directPath)) return Buffer.alloc(0);
    const stream = await downloadContentFromMessage(m, type);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
    if (filename) await fs.promises.writeFile(filename, buffer);
    return filename && fs.existsSync(filename) ? filename : buffer;
  };

  sock.decodeJid = jid => {
    if (!jid) return jid;
    if (/:\d+@/gi.test(jid)) {
      const decode = jidDecode(jid) || {};
      return decode.user && decode.server ? `${decode.user}@${decode.server}` : jid;
    }
    return jid;
  };

  return sock;
}

StartBot();