require("./config.js");
const chalk = require("chalk");
const fs = require("fs");
const util = require("util");
const axios = require('axios');
const crypto = require("crypto");
const { exec, spawn, execSync } = require('child_process');
const { 
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    Browsers,
    DisconnectReason,
    jidDecode,
    downloadContentFromMessage,
    prepareWAMessageMedia, 
    generateWAMessageFromContent, 
    generateWAMessageContent, 
    proto 
} = require("baileys");

const loadDb = require("./Files/load_database.js");

// ================= PERBAIKAN AUTOPJM & AUTOSWGC (tidak spam) =================
const kirimAutoJpm = async (sock, force = false) => {
  const setting = global.db.settings.autojpm;
  if (!setting.enabled && !force) return { success: 0, fail: 0, skipped: true };
  const now = Date.now();
  if (!force && (now - setting.lastRun) < setting.interval * 60000)
    return { success: 0, fail: 0, skipped: true };

  // ✅ update lastRun sebelum proses panjang
  global.db.settings.autojpm.lastRun = now;

  const groups = await sock.groupFetchAllParticipating();
  const groupIds = Object.keys(groups).filter(id => !setting.blacklist.includes(id));
  let success = 0, fail = 0;
  for (let id of groupIds) {
    try {
      if (setting.media) {
        const mediaData = setting.media;
        if (mediaData.type === 'image') {
          await sock.sendMessage(id, { 
            image: Buffer.from(mediaData.data, 'base64'), 
            caption: setting.message,
            mimetype: mediaData.mimetype
          });
        } else if (mediaData.type === 'video') {
          await sock.sendMessage(id, { 
            video: Buffer.from(mediaData.data, 'base64'), 
            caption: setting.message,
            mimetype: mediaData.mimetype
          });
        }
      } else {
        await sock.sendMessage(id, { text: setting.message });
      }
      success++;
    } catch (e) {
      fail++;
    }
    await sleep(2000);
  }
  console.log(`Autojpm selesai, sukses: ${success}, gagal: ${fail}`);
  return { success, fail, skipped: false };
};

global.kirimAutoJpm = kirimAutoJpm;

global.kirimAutoSwgc = async (sock, force = false) => {
    const setting = global.db.settings.autojpmswgc;
    if (!setting.enabled && !force) return { success: 0, fail: 0, skipped: true };
    const now = Date.now();
    if (!force && (now - setting.lastRun) < setting.interval * 60000) 
        return { success: 0, fail: 0, skipped: true };

    // ✅ update lastRun sekarang
    global.db.settings.autojpmswgc.lastRun = now;

    let mediaUrl = null;
    let mediaType = null;
    if (setting.media && setting.media.data) {
        const buffer = Buffer.from(setting.media.data, 'base64');
        const mime = setting.media.mimetype;
        if (/image/.test(mime)) {
            mediaUrl = await global.UploadMedia(buffer, 'image.jpg', 'image');
            mediaType = 'image';
        } else if (/video/.test(mime)) {
            mediaUrl = await global.UploadMedia(buffer, 'video.mp4', 'video');
            mediaType = 'video';
        }
        if (!mediaUrl) console.log('Gagal upload media untuk autojpmswgc');
    }

    const groups = await sock.groupFetchAllParticipating();
    const blacklist = setting.blacklist || [];
    const targetGroups = Object.keys(groups).filter(id => !blacklist.includes(id));
    
    let success = 0, failed = 0;
    const bgColors = ["#FF5733", "#33FF57", "#3357FF", "#F033FF", "#FF33F0", "#33FFF0", "#F0FF33", "#FF8333", "#8333FF", "#33FF83"];
    
    for (const jid of targetGroups) {
        try {
            let content;
            if (mediaUrl && mediaType === 'image') {
                content = {
                    image: { url: mediaUrl },
                    caption: setting.message || undefined
                };
            } else if (mediaUrl && mediaType === 'video') {
                content = {
                    video: { url: mediaUrl },
                    caption: setting.message || undefined,
                    gifPlayback: false
                };
            } else {
                const randomColor = bgColors[Math.floor(Math.random() * bgColors.length)];
                content = {
                    text: setting.message,
                    backgroundColor: randomColor,
                    font: Math.floor(Math.random() * 7) + 1
                };
            }
            const inside = await generateWAMessageContent(content, {
                upload: sock.waUploadToServer || (async (buf) => ({ url: await global.UploadMedia(buf, 'temp') })),
                logger: sock.logger
            });
            const messageSecret = crypto.randomBytes(32);
            const msg = await generateWAMessageFromContent(jid, {
                messageContextInfo: { messageSecret },
                groupStatusMessageV2: {
                    message: {
                        ...inside,
                        messageContextInfo: { messageSecret }
                    }
                }
            }, { userJid: sock.user.id });
            await sock.relayMessage(jid, msg.message, { messageId: msg.key.id });
            success++;
            await sleep(2000);
        } catch (err) {
            console.error(`Gagal kirim story ke ${jid}:`, err);
            failed++;
        }
    }
    console.log(`AutoSwgc selesai, sukses: ${success}, gagal: ${failed}`);
    return { success, fail: failed, skipped: false };
};

// ================= AKHIR PERBAIKAN =================

module.exports = async (sock, m) => {
  await loadDb(sock, m);
  const isCmd = m?.body?.startsWith(prefix);
  const quoted = m.quoted ? m.quoted : m;
  const mime = quoted?.msg?.mimetype || quoted?.mimetype || null;
  const args = m?.body?.trim().split(/ +/).slice(1) || [];
  const qmsg = m.quoted || m;
  const text = args.join(" ");
  const command = isCmd
    ? m.body.slice(prefix.length).trim().split(" ").shift().toLowerCase()
    : "";
  const cmd = prefix + command;
  const isOwner = m.isOwner
  let metadata = {};
  if (m.isGroup) {
      try {
          if (global.groupMetadataCache.has(m.chat)) {
              metadata = await global.groupMetadataCache.get(m.chat);
          } else {
              metadata = await sock.groupMetadata(m.chat);
              global.groupMetadataCache.set(m.chat, metadata);
          }
      } catch (e) {
          metadata = {};
      }
  }
  const admins = metadata?.participants
    ? metadata.participants.filter(p => p.admin !== null).map(p => p.id)
    : [];
  m.isAdmin = m.isGroup && admins ? admins.includes(m.sender) : false
  m.isBotAdmin = m.isGroup && admins ? admins.includes(m.botNumber) : false
    
  const qtext = {key: {remoteJid: "status@broadcast", participant: "0@s.whatsapp.net"}, message: {"extendedTextMessage": {"text": `By ${namaOwner}`}}}

// ========== CEK MODE SELF / PUBLIC ==========
if (isCmd) {
  const currentMode = global.db.settings.mode || "public";
  if (currentMode === "self" && !m.isOwner) {
    // Hanya owner yang bisa menggunakan perintah apapun dalam mode self
    return m.reply(`🔒 Bot dalam mode *SELF*. Hanya owner yang dapat menggunakan perintah.\nKetik *${prefix}public* untuk mengubah ke mode publik.`);
  }
}
if (isCmd) {
    const currentMode = global.db.settings.mode || "public";
    const time = new Date().toLocaleTimeString("id-ID", {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });

    console.log(
        `\n${chalk.hex('#00F5FF').bold(' ╭▢ Command detected')}\n` +
        `${chalk.hex('#00F5FF')(' │•')} ${chalk.yellow('Time    :')} ${time}\n` +
        `${chalk.hex('#00F5FF')(' │•')} ${chalk.yellow('Cmd     :')} ${chalk.magentaBright.bold(cmd.toUpperCase())}\n` +
        `${chalk.hex('#00F5FF')(' │•')} ${chalk.yellow('Sender  :')} ${chalk.white(m.sender.split('@')[0])}\n` +
        `${chalk.hex('#00F5FF')(' │•')} ${chalk.yellow('Chat    :')} ${chalk.white(m.isGroup ? metadata.subject.substring(0, 20) : "Private")}\n` +
        `${chalk.hex('#00F5FF').bold(' ╰•')} ${chalk.green('Status  :')} ${chalk.white('Success')}\n`
    );
    if (currentMode === "self" && !m.isOwner) {
    return m.reply(`🔒 Bot dalam mode *SELF*. Hanya owner yang dapat menggunakan perintah.\nKetik *${prefix}public* untuk mengubah ke mode publik.`);
  }
}
  switch (command) {
case "menu":
case "allcommand": {
    const date = new Date();
    const options = {
        timeZone: 'Asia/Jakarta',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour12: false
    };
    const formatter = new Intl.DateTimeFormat('id-ID', options);
    const parts = formatter.formatToParts(date);
    const hari = parts.find(p => p.type === 'weekday').value;
    const tanggal = `${parts.find(p => p.type === 'day').value} ${parts.find(p => p.type === 'month').value} ${parts.find(p => p.type === 'year').value}`;
    const jam = parseInt(parts.find(p => p.type === 'hour').value);
    const menit = parts.find(p => p.type === 'minute').value;
    const detik = parts.find(p => p.type === 'second').value;
    let ucapanWaktu = "Malam";
    if (jam >= 4 && jam < 11) ucapanWaktu = "Pagi";
    else if (jam >= 11 && jam < 15) ucapanWaktu = "Siang";
    else if (jam >= 15 && jam < 18) ucapanWaktu = "Sore";
    const processRuntime = (seconds) => {
        const d = Math.floor(seconds / (3600 * 24));
        const h = Math.floor((seconds % (3600 * 24)) / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        return `${d}d ${h}h ${m}m ${s}s`;
    };
    const modeStatus = global.db.settings.mode === "self" ? "🔒 Self" : "🌍 Public";

    const runtime = processRuntime(process.uptime());
    const menuText = `Hai ${ucapanWaktu} kak @${m.sender.split("@")[0]}👋

╭▢ *#Bot information*
│• Botname: ${global.botName}
│• Mode: ${modeStatus}
│• Owner: ${global.namaOwner}
│• Runtime: ${runtime}
│• Waktu: ${hari}, ${jam}:${menit}
╰• Tanggal: ${tanggal}

╭▢ *#Top Gainer*
│• .swgrupall
│• .joinallgrup
│• .outgrup
│• .autoswgrup
│• .setswgrup
│• .autojpm
╰• .setjpm

╭▢ *#Store menu*
│• .pushkontak
│• .setjedapush
│• .stoppush
│• .jaser
│• .jaserht
│• .jedajaser
│• .addlist
│• .dellist
╰• .list

╭▢ *#Other menu*
│• .self
│• .public
│• .pin
│• .clearsession
│• .enc1-10
│• .tourl
│• .brat
│• .cekidch
│• .backupsc
│• .resetsc
│• .payment
│• .done
╰• .proses`;

    const quotedTemplate = {
        key: {
            remoteJid: 'status@broadcast',
            participant: '0@s.whatsapp.net'
        },
        message: {
            newsletterAdminInviteMessage: {
                newsletterJid: global.idSaluran,
                newsletterName: global.namaSaluran,
                caption: `Original by Fyxzpedia`,
                inviteExpiration: 0
            }
        }
    };

    try {
        await sock.sendMessage(m.chat, {
            image: { url: global.thumbnailmenu },
            caption: menuText,
            mentions: [m.sender]
        }, { quoted: quotedTemplate });
    } catch {}
}
break;
case "pin":
case "semat": {
  // Otorisasi
  if (m.isGroup) {
    if (!m.isAdmin && !isOwner) return m.reply(mess.admin);
  } else {
    if (!isOwner) return m.reply("❌ Hanya owner yang bisa menyemat pesan di private chat.");
  }
  if (!m.quoted) return m.reply(`Balas pesan yang ingin disematkan!\nContoh: ${cmd} (reply ke pesan target)`);

  try {
    const key = m.quoted.key;
    const participant = key.participant || key.remoteJid;
    const msgId = key.id;
    const attrs = { id: msgId, participant: participant };
    if (key.fromMe) attrs.fromMe = "true";

    await sock.query({
      tag: "iq",
      attrs: {
        to: m.chat,
        type: "set",
        xmlns: "w:sync:app:state",
        id: `pin-${Date.now()}`
      },
      content: [
        {
          tag: "sync",
          attrs: {},
          content: [
            {
              tag: "pin",
              attrs: {},
              content: [
                { tag: "add", attrs: attrs }
              ]
            }
          ]
        }
      ]
    });

    m.reply(`📌 Pesan berhasil disematkan di ${m.isGroup ? "grup" : "chat ini"}.`);
  } catch (err) {
    console.error("[PIN] Error:", err);
    m.reply(`❌ Gagal menyematkan pesan.\nError: ${err.message || err}`);
  }
}
break;

case "unpin":
case "unsemat": {
  // Otorisasi
  if (m.isGroup) {
    if (!m.isAdmin && !isOwner) return m.reply(mess.admin);
  } else {
    if (!isOwner) return m.reply("❌ Hanya owner yang bisa melepas sematan di private chat.");
  }
  if (!m.quoted) return m.reply(`Balas pesan yang ingin dilepas sematannya!\nContoh: ${cmd} (reply ke pesan yang sudah disemat)`);

  try {
    const key = m.quoted.key;
    const participant = key.participant || key.remoteJid;
    const msgId = key.id;
    const attrs = { id: msgId, participant: participant };
    if (key.fromMe) attrs.fromMe = "true";

    await sock.query({
      tag: "iq",
      attrs: {
        to: m.chat,
        type: "set",
        xmlns: "w:sync:app:state",
        id: `unpin-${Date.now()}`
      },
      content: [
        {
          tag: "sync",
          attrs: {},
          content: [
            {
              tag: "pin",
              attrs: {},
              content: [
                { tag: "remove", attrs: attrs }
              ]
            }
          ]
        }
      ]
    });

    m.reply(`📌 Sematan pesan berhasil dilepas dari ${m.isGroup ? "grup" : "chat ini"}.`);
  } catch (err) {
    console.error("[UNPIN] Error:", err);
    m.reply(`❌ Gagal melepas sematan.\nError: ${err.message || err}`);
  }
}
break;
case "self": {
  if (!isOwner) return m.reply(mess.owner);
  if (global.db.settings.mode === "self") return m.reply("ℹ️ Bot sudah dalam mode SELF.");
  global.db.settings.mode = "self";
  m.reply("✅ *Mode SELF* diaktifkan.\nSekarang hanya owner yang bisa menggunakan perintah.");
}
break;

case "public": {
  if (!isOwner) return m.reply(mess.owner);
  if (global.db.settings.mode === "public") return m.reply("ℹ️ Bot sudah dalam mode PUBLIC.");
  global.db.settings.mode = "public";
  m.reply("✅ *Mode PUBLIC* diaktifkan.\nSemua user sekarang dapat menggunakan perintah.");
}
break;

case "clearsession": {
    if (!isOwner) return m.reply(mess.owner);
    const fs = require('fs');
    const path = require('path');
    const sessionPath = './session';
    if (!fs.existsSync(sessionPath)) return m.reply("folder session tidak ditemukan.");
    let deletedFiles = 0;
    const files = fs.readdirSync(sessionPath);
    await m.reply("sedang membersihkan cache session...");
    for (const file of files) {
        if (file !== 'creds.json') {
            try {
                const filePath = path.join(sessionPath, file);
                const stat = fs.statSync(filePath);
                if (stat.isDirectory()) {
                    fs.rmSync(filePath, { recursive: true, force: true });
                } else {
                    fs.unlinkSync(filePath);
                }
                deletedFiles++;
            } catch (err) { console.error(`gagal hapus ${file}:`, err); }
        }
    }
    await m.reply(`✅ berhasil membersihkan ${deletedFiles} file sampah.`);
}
break;

case "settfotomenu":
case "setfotomenu": {
    if (!isOwner) return m.reply(mess.owner);
    let mediaBuffer = null;
    if (/image/.test(mime)) {
        mediaBuffer = await (m.quoted ? m.quoted.download() : m.download());
    } else {
        return m.reply(`kirim gambar dengan caption *${prefix}${cmd}* atau reply gambar.`);
    }
    if (!mediaBuffer) return m.reply("gagal mengunduh gambar.");
    await m.reply("sedang mengunggah gambar...");
    try {
        const mediaUrl = await global.UploadMedia(mediaBuffer, 'menu.jpg', 'image');
        if (!mediaUrl) throw new Error("gagal upload.");
        global.thumbnailmenu = mediaUrl;
        if (!global.db.settings) global.db.settings = {};
        global.db.settings.thumbnailmenu = mediaUrl;
        m.reply(`✅ foto menu berhasil diperbarui.\nurl: ${mediaUrl}\nketik .menu untuk melihat perubahan.`);
    } catch (err) {
        console.error(err);
        m.reply("terjadi kesalahan: " + err.message);
    }
}
break;

case "saluran": {
    const channelLink = global.linkSaluran || "https://whatsapp.com/channel/0029VbBouHp0rGiGXagM0f2e";
    await sock.sendMessage(m.chat, {
        text: `📢 *saluran resmi ${global.botName}*\n\nklik link berikut:\n${channelLink}\natau ketik .list untuk fitur lain.`,
        buttons: [{
            buttonId: channelLink,
            buttonText: { displayText: "buka saluran" },
            type: 1
        }],
        headerType: 1
    }, { quoted: m });
}
break;

case "list": {
    const lists = global.db.settings.lists || {};
    const listNames = Object.keys(lists);
    if (listNames.length === 0) return m.reply("belum ada list. gunakan .addlist nama|isi");
    let text = "*daftar list:*\n\n";
    listNames.forEach((name, i) => {
        text += `${i+1}. .${name}\n`;
    });
    text += "\nketik .nama_list untuk melihat isinya.";
    m.reply(text);
}
break;

case "addlist": {
    if (!text && !(m.quoted && m.quoted.text) && !/image|video/.test(mime)) {
        return m.reply(`cara: ${cmd} nama|isi\natau kirim media dengan caption ${cmd} nama|isi\natau reply pesan teks/media dengan ${cmd} nama|isi`);
    }
    let pipeIndex = text.indexOf('|');
    if (pipeIndex === -1) return m.reply(`format salah! gunakan: ${cmd} nama|isi teks`);
    let listName = text.substring(0, pipeIndex).trim().toLowerCase();
    let listText = text.substring(pipeIndex + 1).trim();
    if (!listName) return m.reply("nama list tidak boleh kosong!");
    if (!listText && !/image|video/.test(mime)) return m.reply("isi teks tidak boleh kosong!");
    let media = null;
    if (/image|video/.test(mime)) {
        const buffer = await (m.quoted ? m.quoted.download() : m.download());
        if (buffer) {
            media = {
                type: /image/.test(mime) ? 'image' : 'video',
                data: buffer.toString('base64'),
                mimetype: mime
            };
        }
    } else if (m.quoted && /image|video/.test(m.quoted.mimetype || m.quoted.msg?.mimetype)) {
        const quotedMime = m.quoted.mimetype || m.quoted.msg?.mimetype;
        const buffer = await m.quoted.download();
        if (buffer) {
            media = {
                type: /image/.test(quotedMime) ? 'image' : 'video',
                data: buffer.toString('base64'),
                mimetype: quotedMime
            };
        }
    }
    if (!global.db.settings.lists) global.db.settings.lists = {};
    global.db.settings.lists[listName] = {
        text: listText || "",
        media: media || null
    };
    m.reply(`✅ list *${listName}* berhasil ditambahkan.`);
}
break;

case "dellist": {
    if (!text) return m.reply(`contoh: ${cmd} namabarang`);
    const listName = text.trim().toLowerCase();
    const lists = global.db.settings.lists || {};
    if (!lists[listName]) return m.reply(`❌ list *${listName}* tidak ditemukan.`);
    delete lists[listName];
    m.reply(`✅ list *${listName}* berhasil dihapus.`);
}
break;

case 'enc1': case 'enc2': case 'enc3': case 'enc4': case 'enc5':
case 'enc6': case 'enc7': case 'enc8': case 'enc9': case 'enc10': {
    if (!m.quoted) return m.reply(`balas teks atau file .js yang ingin di-encrypt!`);
    const JavaScriptObfuscator = require('javascript-obfuscator');
    let kodeAsli = m.quoted.text || m.quoted.body || (m.quoted.download ? (await m.quoted.download()).toString() : "");
    if (!kodeAsli) return m.reply("kode tidak ditemukan!");
    const encodeZero = (text) => text.split('').map(c => c.charCodeAt(0).toString(2).padStart(8, '0').split('').map(b => (b === '1' ? '\u200b' : '\u200c')).join('') + '\u200d').join('');
    try {
        let opt = { compact: true, controlFlowFlattening: false };
        let level = parseInt(command.replace('enc', ''));
        switch (level) {
            case 1: opt = { compact: true, simplify: true }; break;
            case 2: opt = { compact: true, renameGlobals: true }; break;
            case 3: opt = { compact: true, controlFlowFlattening: true, controlFlowFlatteningThreshold: 0.5 }; break;
            case 4: opt = { compact: true, controlFlowFlattening: true, deadCodeInjection: true, deadCodeInjectionThreshold: 0.2 }; break;
            case 5: opt = { compact: true, stringArray: true, stringArrayThreshold: 0.75, selfDefending: true }; break;
            case 6: opt = { compact: true, controlFlowFlattening: true, stringArrayEncoding: ['base64'], debugProtection: true }; break;
            case 7: opt = { compact: true, splitStrings: true, splitStringsChunkLength: 3, unicodeEscapeSequence: true }; break;
            case 8: opt = { compact: true, controlFlowFlattening: true, deadCodeInjection: true, stringArrayEncoding: ['rc4'], transformObjectKeys: true }; break;
            case 9: opt = { compact: true, controlFlowFlattening: true, selfDefending: true, stringArrayEncoding: ['base64', 'rc4'], numbersToExpressions: true }; break;
            case 10: opt = { compact: true, simplify: true, unicodeEscapeSequence: true, identifierNamesGenerator: 'hexadecimal' }; break;
        }
        let hasilEnc = JavaScriptObfuscator.obfuscate(kodeAsli, opt).getObfuscatedCode();
        if (level === 10) {
            let encoded = encodeZero(hasilEnc);
            hasilEnc = `eval((function(w){return w.split('\\u200d').filter(x=>x).map(x=>String.fromCharCode(parseInt(x.replace(/\\u200b/g,'1').replace(/\\u200c/g,'0'),2))).join('')})('${encoded}'))`;
        }
        await sock.sendMessage(m.chat, { 
            document: Buffer.from(hasilEnc), 
            mimetype: 'application/javascript', 
            fileName: `level_${level}_encrypted.js`,
            caption: `obfuscate level ${level} - sukses ✅`
        }, { quoted: m });
    } catch (e) {
        console.error(e);
        m.reply("terjadi kesalahan. pastikan kode js valid.");
    }
}
break;

case "tourl":
case "toupload": {
    let mediaBuffer = null;
    let mediaType = "image";
    let filename = "media";
    if (m.quoted && (m.quoted.mimetype || m.quoted.msg?.mimetype)) {
        const quotedMime = m.quoted.mimetype || m.quoted.msg?.mimetype;
        if (/image/.test(quotedMime)) {
            mediaBuffer = await m.quoted.download();
            mediaType = "image";
            filename = "image.jpg";
        } else if (/video/.test(quotedMime)) {
            mediaBuffer = await m.quoted.download();
            mediaType = "video";
            filename = "video.mp4";
        } else return m.reply("hanya gambar atau video yang didukung.");
    } else if (/image|video/.test(mime)) {
        mediaBuffer = await (m.quoted ? m.quoted.download() : m.download());
        if (/image/.test(mime)) { mediaType = "image"; filename = "image.jpg"; }
        else if (/video/.test(mime)) { mediaType = "video"; filename = "video.mp4"; }
    } else {
        return m.reply(`cara:\n1. reply pesan gambar/video dengan ${cmd}\n2. kirim langsung gambar/video dengan caption ${cmd}`);
    }
    if (!mediaBuffer || mediaBuffer.length === 0) return m.reply("gagal membaca media.");
    await m.reply(`⏳ mengunggah ${mediaType}...`);
    try {
        const url = await global.UploadMedia(mediaBuffer, filename, mediaType);
        if (url && url.startsWith("http")) {
            await m.reply(`✅ upload berhasil!\nurl: ${url}\ntipe: ${mediaType}\nukuran: ${(mediaBuffer.length / 1024 / 1024).toFixed(2)} MB`);
        } else throw new Error("url tidak valid");
    } catch (err) {
        console.error(err);
        await m.reply(`❌ gagal mengunggah ${mediaType}.`);
    }
}
break;

case "brat": {
    if (!text && !(m.quoted && m.quoted.text)) return m.reply(`contoh: ${cmd} teks\natau reply pesan teks.\n\nmembuat stiker bergaya brat.`);
    let userText = text;
    if (m.quoted && m.quoted.text) userText = m.quoted.text;
    const apikey = "123";
    const encodedText = encodeURIComponent(userText);
    const apiUrl = `https://fyxzpedia-apikeys.vercel.app/imagecreator/bratvid?apikey=${apikey}&text=${encodedText}`;
    await m.reply(`🎨 membuat stiker brat: "${userText.substring(0, 30)}${userText.length > 30 ? '...' : ''}"`);
    try {
        const response = await axios.get(apiUrl, { responseType: 'arraybuffer' });
        const imageBuffer = Buffer.from(response.data);
        const Sticker = require('wa-sticker-formatter').Sticker;
        const sticker = new Sticker(imageBuffer, { pack: 'Brat Style', author: global.namaOwner || 'Brat', type: 'full', quality: 50 });
        const stickerBuffer = await sticker.toBuffer();
        await sock.sendMessage(m.chat, { sticker: stickerBuffer }, { quoted: m });
    } catch (err) {
        console.error(err);
        await m.reply("❌ gagal membuat stiker brat.");
    }
}
break;

case "npmdl": {
    if (!isOwner) return m.reply(mess.owner);
    let packageName = text.trim();
    if (!packageName) return m.reply(`contoh: .npmdl @fyxzpedia/bail`);
    await m.reply(`⏳ mencari package *${packageName}*...`);
    try {
        const registryUrl = `https://registry.npmjs.org/${packageName}`;
        const data = await global.fetchJson(registryUrl);
        const latestVersion = data['dist-tags']?.latest;
        if (!latestVersion) throw new Error("versi terbaru tidak ditemukan");
        const tarballUrl = data.versions[latestVersion]?.dist?.tarball;
        if (!tarballUrl) throw new Error("tarball tidak ditemukan");
        await m.reply(`📦 package: ${packageName}@${latestVersion}\n📥 mengunduh...`);
        const buffer = await global.getBuffer(tarballUrl);
        const fileName = `${packageName.replace('/', '-')}-${latestVersion}.tgz`;
        const filePath = `./tmp/${fileName}`;
        if (!fs.existsSync('./tmp')) fs.mkdirSync('./tmp');
        fs.writeFileSync(filePath, buffer);
        const fileSize = (fs.statSync(filePath).size / 1024 / 1024).toFixed(2);
        await sock.sendMessage(m.chat, {
            document: fs.readFileSync(filePath),
            fileName: fileName,
            mimetype: 'application/zip',
            caption: `✅ download selesai\npackage: ${packageName}\nversi: ${latestVersion}\nukuran: ${fileSize} mb`
        }, { quoted: m });
        fs.unlinkSync(filePath);
    } catch (error) {
        console.error(error);
        m.reply(`❌ gagal mendownload package: ${error.message}`);
    }
}
break;

case "outgrup": {
    if (!isOwner) return m.reply(mess.owner);
    const msg = generateWAMessageFromContent(m.chat, {
        viewOnceMessage: {
            message: {
                messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
                interactiveMessage: {
                    header: { title: "keluar grup" },
                    body: { text: "pilih opsi di bawah:" },
                    footer: { text: "owner control panel" },
                    nativeFlowMessage: {
                        buttons: [
                            { name: "quick_reply", buttonParamsJson: JSON.stringify({ display_text: "keluar semua grup", id: ".outallgrup" }) },
                            { name: "quick_reply", buttonParamsJson: JSON.stringify({ display_text: "keluar grup tertutup", id: ".outgruptertutup" }) }
                        ]
                    }
                }
            }
        }
    }, { quoted: m });
    await sock.relayMessage(m.chat, msg.message, { messageId: msg.key.id });
}
break;

case "outallgrup": {
  if (!isOwner) return m.reply(mess.owner);
  await m.reply("⏳ Memproses keluar dari semua grup (jeda 1 detik antar grup)...");
  
  const getGroups = await sock.groupFetchAllParticipating();
  const groups = Object.keys(getGroups);
  if (groups.length === 0) return m.reply("Bot tidak tergabung di grup manapun.");
  
  let successCount = 0, failCount = 0;
  
  for (let id of groups) {
    try {
      // Kirim pesan perpisahan (opsional, abaikan jika gagal)
      try {
        await sock.sendMessage(id, { text: "Bot akan keluar dari grup ini. Terima kasih!" });
      } catch (e) {}
      await sock.groupLeave(id);
      successCount++;
    } catch (err) {
      failCount++;
    }
    await sleep(1000); // jeda 1 detik setelah setiap percobaan keluar
  }
  
  await m.reply(`✅ Berhasil keluar dari semua grup\nTotal grup: ${groups.length}\n✅ Sukses: ${successCount}\n❌ Gagal: ${failCount}`);
}
break;

case "outgruptertutup": {
  if (!isOwner) return m.reply(mess.owner);
  await m.reply("⏳ Mencari grup tertutup (hanya admin) dan keluar... (jeda 1 detik)");
  
  const getGroups = await sock.groupFetchAllParticipating();
  const groups = Object.keys(getGroups);
  let count = 0;
  
  for (let id of groups) {
    try {
      let metadata = await sock.groupMetadata(id);
      if (metadata.announce === true) { // hanya grup tertutup (admin approval)
        await sock.groupLeave(id);
        count++;
      }
    } catch (err) {}
    await sleep(1000); // jeda 1 detik setelah setiap pengecekan (baik keluar maupun tidak)
  }
  
  await m.reply(`✅ Berhasil keluar dari ${count} grup tertutup.`);
}
break;

case "joinallgrup":
case "joinallgc": {
  if (!isOwner) return m.reply(mess.owner);
  let content = text;
  if (m.quoted && m.quoted.text) content = m.quoted.text;
  if (!content) return m.reply(`❌ Masukkan kumpulan link grup.\nContoh: ${prefix}${cmd} https://chat.whatsapp.com/abc123\nAtau reply pesan berisi link.`);
  
  const linkRegex = /(?:chat\.whatsapp\.com\/(?:invite\/)?)([0-9A-Za-z]{20,24})/ig;
  let matches = [...content.matchAll(linkRegex)];
  let links = matches.map(match => match[1]);
  links = [...new Set(links)];
  
  if (links.length === 0) return m.reply("Tidak ada link grup valid.");
  
  await m.reply(`⏳ Menemukan ${links.length} link unik.\nMemulai join... (jeda 1 detik per grup)`);
  
  let sukses = 0, gagal = 0, gagalLinks = [];
  
  for (const code of links) {
    try {
      await sock.groupAcceptInvite(code);
      sukses++;
    } catch (err) {
      gagal++;
      gagalLinks.push(code);
    }
    await sleep(1000); // jeda 1 detik setelah setiap percobaan
  }
  
  let resultMsg = `✅ Proses join selesai!\n\n📊 Total link: ${links.length}\n✅ Berhasil: ${sukses}\n❌ Gagal: ${gagal}`;
  if (gagalLinks.length > 0) {
    resultMsg += `\n\nGagal pada kode:\n${gagalLinks.map((l, i) => `${i+1}. ${l}`).join('\n')}`;
  }
  m.reply(resultMsg);
}
break;

case "resetsc": {
    if (!isOwner) return m.reply(mess.owner);
    await m.reply("⏳ mereset database ke pengaturan awal...");
    try {
        global.db.settings = {
            namaSaveContact: "Customer",
            jedaPushkontak: 2000,
            lists: {},
            blacklistJpm: [],
            delayJaser: 4000,
            thumbnailmenu: global.thumbnailmenu,
            paymentImage: global.paymentImage,
            autojpm: {
                enabled: false,
                message: 'Halo ini pesan otomatis',
                media: null,
                interval: 60,
                lastRun: 0,
                blacklist: []
            },
            autoJoinGC: { enabled: false },
            autojpmswgc: {
                enabled: false,
                message: 'Halo ini story otomatis',
                media: null,
                interval: 60,
                lastRun: 0,
                blacklist: []
            }
        };
        await global.db.write ? global.db.write(global.db) : null;
        m.reply("✅ berhasil reset database! semua pengaturan kembali ke awal.");
    } catch (err) {
        console.error(err);
        m.reply("❌ terjadi kesalahan: " + err.message);
    }
    break; // ← jangan lupa break
}
case "payment": {
    if (!isOwner) return m.reply(mess.owner);
    const imageUrl = global.paymentImage;
    const caption = `───╼ *Metode Payment* ╾───

Gopay: ${global.gopay || "-"}
Dana: ${global.dana || "-"}
Ovo: ${global.ovo || "-"}

Noted!! 
Sertakan bukti pembayaran untuk keamanan transaksi bersama`;
    const quotedTemplate = {
        key: { remoteJid: 'status@broadcast', participant: '0@s.whatsapp.net' },
        message: { newsletterAdminInviteMessage: { newsletterJid: global.idSaluran, newsletterName: global.namaSaluran, caption: `Payment Info`, inviteExpiration: 0 } }
    };
    await sock.sendMessage(m.chat, { image: { url: imageUrl }, caption: caption }, { quoted: quotedTemplate });
}
break;
case "payment": {
    if (!isOwner) return m.reply(mess.owner);
    const imageUrl = global.paymentImage;
    const caption = `*All List Rekening Pembayaran*

▢ Gopay: ${global.gopay || "-"}
▢ Dana: ${global.dana || "-"}
▢ Ovo: ${global.ovo || "-"}

Noted! 
Untuk Keamanan Sertakan bukti pembayaran.`;

    // Siapkan tombol copy hanya untuk nomor yang valid
    const buttons = [];
    if (global.gopay && global.gopay !== "-") {
        buttons.push({
            name: "cta_copy",
            buttonParamsJson: JSON.stringify({
                display_text: "📋 Copy Gopay",
                copy_code: global.gopay
            })
        });
    }
    if (global.dana && global.dana !== "-") {
        buttons.push({
            name: "cta_copy",
            buttonParamsJson: JSON.stringify({
                display_text: "📋 Copy Dana",
                copy_code: global.dana
            })
        });
    }
    if (global.ovo && global.ovo !== "-") {
        buttons.push({
            name: "cta_copy",
            buttonParamsJson: JSON.stringify({
                display_text: "📋 Copy Ovo",
                copy_code: global.ovo
            })
        });
    }

    // Jika tidak ada tombol (semua nomor kosong), kirim pesan biasa
    if (buttons.length === 0) {
        await sock.sendMessage(m.chat, { image: { url: imageUrl }, caption: caption }, { quoted: m });
        return;
    }

    try {
        // Kirim interactive message dengan tombol copy
        await sock.sendMessage(m.chat, {
            interactiveMessage: {
                header: {
                    title: "💳 Payment Methods",
                    hasMediaAttachment: true,
                    imageMessage: { url: imageUrl }
                },
                body: { text: caption },
                footer: { text: global.botName },
                buttons: buttons
            }
        }, { quoted: m });
    } catch (err) {
        // Fallback jika interactive message gagal
        console.error("Gagal kirim interactive payment:", err);
        await sock.sendMessage(m.chat, { image: { url: imageUrl }, caption: caption }, { quoted: m });
    }
}
break;

case "done":
case "proses": {
    if (!isOwner) return m.reply(mess.owner);
    if (!text) return m.reply(`contoh: ${cmd} nama barang`);
    const status = command === "done" ? "done ✅" : "proses 🔄";
    const tanggal = new Date().toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const pesan = `terima kasih telah order ✅\n📦 ${text}\nstatus : ${status}\ntanggal : ${tanggal}\n\n📢 link free script bot\nhttps://www.mediafire.com/folder/9h2x8mqxsdl9m/FyxzpediaYT`;
    const quotedTemplate = {
        key: { remoteJid: 'status@broadcast', participant: '0@s.whatsapp.net' },
        message: { newsletterAdminInviteMessage: { newsletterJid: global.idSaluran, newsletterName: global.namaSaluran, caption: `Order Status`, inviteExpiration: 0 } }
    };
    await sock.sendMessage(m.chat, { text: pesan }, { quoted: quotedTemplate });
}
break;

case "autoswgrup": {
    if (!isOwner) return m.reply(mess.owner);
    const sub = args[0]?.toLowerCase();
    if (sub === 'on') {
        global.db.settings.autojpmswgc.enabled = true;
        m.reply('✅ auto story grup diaktifkan');
    } else if (sub === 'off') {
        global.db.settings.autojpmswgc.enabled = false;
        m.reply('✅ auto story grup dimatikan');
    } else if (sub === 'status') {
        const s = global.db.settings.autojpmswgc;
        let last = s.lastRun ? new Date(s.lastRun).toLocaleString('id-ID') : 'belum pernah';
        let next = s.enabled && s.lastRun ? new Date(s.lastRun + s.interval*60000).toLocaleString('id-ID') : '-';
        let mediaInfo = s.media ? (s.media.type === 'image' ? 'gambar ✅' : 'video ✅') : 'tidak ada media';
        let teks = `status auto story grup\n\nnyala: ${s.enabled ? '✅' : '❌'}\npesan: ${s.message}\nmedia: ${mediaInfo}\ninterval: ${s.interval} menit\nterakhir: ${last}\nberikutnya: ${next}`;
        m.reply(teks);
    } else {
        m.reply(`penggunaan auto story grup\n• ${cmd} on\n• ${cmd} off\n• ${cmd} status`);
    }
}
break;

case "setswgrup": {
    if (!isOwner) return m.reply(mess.owner);
    if (!text) return m.reply(`contoh: ${cmd} 1jam|halo semua\n\nkirim dengan gambar/video untuk menyertakan media.\nformat interval: angka + jam/menit/detik`);
    let pipeIndex = text.indexOf('|');
    if (pipeIndex === -1) return m.reply('gunakan format: interval|pesan\ncontoh: 1jam|halo semua');
    let intervalStr = text.substring(0, pipeIndex).trim();
    let newMsg = text.substring(pipeIndex + 1).trim();
    if (!newMsg) return m.reply('masukkan teks pesan');
    let interval = global.db.settings.autojpmswgc.interval;
    if (intervalStr) {
        let parsed = global.parseDuration(intervalStr);
        if (!parsed) return m.reply('format interval salah. contoh: 1jam, 30menit');
        interval = parsed;
    }
    let media = null;
    if (/image/.test(mime)) {
        const buffer = await (m.quoted ? m.quoted.download() : m.download());
        if (buffer) media = { type: 'image', data: buffer.toString('base64'), mimetype: mime };
    } else if (/video/.test(mime)) {
        const buffer = await (m.quoted ? m.quoted.download() : m.download());
        if (buffer) media = { type: 'video', data: buffer.toString('base64'), mimetype: mime };
    }
    global.db.settings.autojpmswgc.message = newMsg;
    global.db.settings.autojpmswgc.media = media;
    global.db.settings.autojpmswgc.interval = interval;
    let replyMsg = `✅ pesan auto story grup diperbarui:\n"${newMsg.substring(0, 100)}${newMsg.length > 100 ? '...' : ''}"\ninterval: ${interval} menit`;
    if (media) replyMsg += `\nmedia ${media.type} disertakan.`;
    else replyMsg += `\n(tanpa media)`;
    m.reply(replyMsg);
}
break;
case "stalkch":
case "sch":
case "idch":
case "cekidch": {
    if (!text) return m.reply(`contoh: ${cmd} link/id channel`);
    if (!text.includes("https://whatsapp.com/channel/") && !text.includes("@newsletter"))
        return m.reply("link atau id channel tidak valid");
    let result = text.trim(), opsi = "jid";
    if (text.includes("https://whatsapp.com/channel/")) {
        result = text.split("https://whatsapp.com/channel/")[1];
        opsi = "invite";
    }
    const res = await sock.newsletterMetadata(opsi, result);
    const teks = `channel info\n\n- nama: ${res.name}\n- pengikut: ${global.toRupiah(res.subscribers)}\n- id: ${res.id}\n- link: https://whatsapp.com/channel/${res.invite}`;
    const msg = generateWAMessageFromContent(m.chat, {
        viewOnceMessage: {
            message: {
                interactiveMessage: {
                    body: { text: teks },
                    nativeFlowMessage: {
                        buttons: [
                            { name: "cta_copy", buttonParamsJson: JSON.stringify({ display_text: "copy channel id", copy_code: res.id }) }
                        ]
                    }
                }
            }
        }
    }, { userJid: m.sender, quoted: m });
    await sock.relayMessage(m.chat, msg.message, { messageId: msg.key.id });
}
break;

case "pushkontak":
case "puskontak": {
    if (!isOwner) return m.reply(mess.owner);
    if (!text) return m.reply(`contoh:\n${cmd} teks pesan yang akan dikirim ke setiap member`);
    global.textpushkontak = text;
    const groups = await sock.groupFetchAllParticipating();
    if (!groups || Object.keys(groups).length === 0) return m.reply("❌ bot tidak tergabung di grup manapun.");
    global.dataAllGrup = groups;
    const rows = Object.values(groups).map(g => ({
        title: g.subject || "tanpa nama",
        description: `👥 ${g.participants.length} member`,
        id: `.pushkontak-response ${g.id}`
    }));
    await sock.sendMessage(m.chat, {
        text: `push kontak\n\npilih grup target:\n\npesan: ${text}`,
        viewOnce: true,
        buttons: [
            {
                buttonId: "select_gc",
                buttonText: { displayText: "pilih grup" },
                type: 4,
                nativeFlowInfo: {
                    name: "single_select",
                    paramsJson: JSON.stringify({
                        title: "daftar grup",
                        sections: [{ title: "pilih target grup", rows }]
                    })
                }
            }
        ],
        headerType: 1
    }, { quoted: m });
}
break;

case "pushkontak-response": {
    if (!isOwner) return;
    if (!global.textpushkontak || !global.dataAllGrup) return m.reply("❌ data pushkontak tidak ditemukan\nulangi dengan .pushkontak pesan");
    const groupId = text;
    const groupData = global.dataAllGrup[groupId];
    if (!groupData) return m.reply("❌ grup tidak ditemukan.");
    const messageText = global.textpushkontak;
    global.statusPushkontak = true;
    let members = groupData.participants.map(p => p.id).filter(jid => jid && jid !== m.botNumber);
    const namaKontak = global.db.settings.namaSaveContact || "tidak diset";
    await m.reply(`🚀 memulai pushkontak\n\n📌 grup : ${groupData.subject}\n👥 total : ${members.length} member\n⏱️ jeda : ${global.db.settings.jedaPushkontak} ms\n📝 nama kontak : ${namaKontak}`);
    const quotedTemplate = {
        key: { remoteJid: 'status@broadcast', participant: '0@s.whatsapp.net' },
        message: { newsletterAdminInviteMessage: { newsletterJid: global.idSaluran || '120363402625644245@newsletter', newsletterName: global.namaSaluran || 'Powered by Fyxzpedia', caption: `© ${global.namaOwner} • ${global.botName}`, inviteExpiration: 0 } }
    };
    let success = 0;
    for (const jid of members) {
        try {
            if (!global.statusPushkontak) break;
            let targetJid = jid;
            if (jid.includes("@s.whatsapp.net")) {
                try { targetJid = await sock.toLid(jid); } catch (e) {}
            }
            if (global.db.settings.namaSaveContact) {
                let contactName = global.db.settings.namaSaveContact + " #" + (targetJid.split("@")[0] || "unknown");
                await sock.saveContact(targetJid, contactName);
                await sleep(500);
            }
            await sock.sendMessage(targetJid, { text: messageText }, { quoted: quotedTemplate });
            success++;
            await sleep(global.db.settings.jedaPushkontak);
        } catch (e) { console.error("gagal push ke:", jid, e.message); }
    }
    delete global.textpushkontak;
    delete global.dataAllGrup;
    global.statusPushkontak = false;
    m.reply(`✅ pushkontak selesai\n\n📤 terkirim ke ${success} dari ${members.length} member`);
}
break;

case "stoppush": {
    if (!isOwner) return m.reply(mess.owner);
    if (!global.statusPushkontak) return m.reply("tidak ada pushkontak yang sedang berjalan!");
    global.statusPushkontak = false;
    m.reply("✅ pushkontak dihentikan.");
}
break;

case "setkontakpush":
case "setkontak": {
    if (!isOwner) return m.reply(mess.owner);
    if (!text) return m.reply(`masukkan nama kontak!\ncontoh: ${cmd} MyBuyer`);
    if (text.includes(" ")) return m.reply("nama kontak dilarang memakai spasi!");
    global.db.settings.namaSaveContact = text;
    m.reply(`✅ nama kontak pushkontak diset: *${text}*`);
}
break;

case "setjedapush":
case "setjedapus": {
    if (!isOwner) return m.reply(mess.owner);
    if (!text) return m.reply(`masukkan angka dalam milidetik (ms)!\n1 detik = 1000\ncontoh: ${cmd} 5000`);
    const jeda = parseInt(text);
    if (isNaN(jeda)) return m.reply("masukkan angka!");
    if (jeda < 500) return m.reply("jeda minimal 500 ms untuk menghindari spam.");
    global.db.settings.jedaPushkontak = jeda;
    m.reply(`✅ jeda pushkontak diset *${jeda} ms* (${jeda/1000} detik)`);
}
break;

case "autojpm": {
    if (!isOwner) return m.reply(mess.owner);
    const sub = args[0]?.toLowerCase();
    if (sub === 'on') {
        global.db.settings.autojpm.enabled = true;
        m.reply('✅ autojpm diaktifkan');
    } else if (sub === 'off') {
        global.db.settings.autojpm.enabled = false;
        m.reply('✅ autojpm dimatikan');
    } else if (sub === 'status') {
        const s = global.db.settings.autojpm;
        let last = s.lastRun ? new Date(s.lastRun).toLocaleString('id-ID') : 'belum pernah';
        let next = s.enabled && s.lastRun ? new Date(s.lastRun + s.interval*60000).toLocaleString('id-ID') : '-';
        let teks = `status autojpm\n\nnyala: ${s.enabled ? '✅' : '❌'}\npesan: ${s.message}\nmedia: ${s.media ? '✅' : '❌'}\ninterval: ${s.interval} menit\nblacklist: ${s.blacklist.length} grup\nterakhir: ${last}\nberikutnya: ${next}`;
        m.reply(teks);
    } else {
        m.reply(`penggunaan autojpm\n• ${cmd} on\n• ${cmd} off\n• ${cmd} status`);
    }
}
break;

case "setjpm": {
    if (!isOwner) return m.reply(mess.owner);
    if (!text) return m.reply(`contoh: ${cmd} halo semuanya|1jam\n\nkirim dengan media (gambar/video) untuk menyertakan media.`);
    let [newMsg, intervalStr] = text.split('|').map(s => s.trim());
    if (!newMsg) return m.reply('masukkan teks pesan');
    let interval = global.db.settings.autojpm.interval;
    if (intervalStr) {
        let parsed = global.parseDuration(intervalStr);
        if (!parsed) return m.reply('format interval salah. contoh: 1jam, 30menit');
        interval = parsed;
    }
    let media = null;
    if (/image|video/.test(mime)) {
        const buffer = await (m.quoted ? m.quoted.download() : m.download());
        if (buffer) media = { type: mime.includes('image') ? 'image' : 'video', data: buffer.toString('base64'), mimetype: mime };
    }
    global.db.settings.autojpm.message = newMsg;
    global.db.settings.autojpm.media = media;
    global.db.settings.autojpm.interval = interval;
    let replyMsg = `✅ pesan autojpm diperbarui:\n"${newMsg}"\ninterval: ${interval} menit`;
    if (media) replyMsg += `\nmedia: ${media.type} disertakan.`;
    else replyMsg += `\n(tanpa media)`;
    m.reply(replyMsg);
}
break;

case "jaser":
case "jasher": {
    if (!isOwner) return m.reply(mess.owner);
    if (!text && !/image/.test(mime)) return m.reply(`contoh: ${cmd} pesan (bisa dengan foto)\natur jeda: .jedajaser 1000ms`);
    const quotedTemplate = {
        key: { remoteJid: 'status@broadcast', participant: '0@s.whatsapp.net' },
        message: { newsletterAdminInviteMessage: { newsletterJid: `120363402625644245@newsletter`, newsletterName: `© Script by Fyxzpedia`, caption: `Script by Fyxzpedia`, inviteExpiration: 0 } }
    };
    let mediaBuffer = null;
    let caption = text;
    if (/image/.test(mime)) {
        mediaBuffer = await (m.quoted ? m.quoted.download() : m.download());
        caption = text;
    }
    const allGroups = await sock.groupFetchAllParticipating();
    const groupIds = Object.keys(allGroups);
    const blacklist = global.db.settings.blacklistJpm || [];
    const targetGroups = groupIds.filter(id => !blacklist.includes(id));
    const delay = global.db.settings.delayJaser || 4000;
    if (targetGroups.length === 0) return m.reply("❌ tidak ada grup target (semua grup diblacklist).");
    await m.reply(`🚀 broadcast ke ${targetGroups.length} grup\npesan: ${caption || "tanpa teks"}\njeda: ${delay} ms (${delay/1000} detik)`);
    let success = 0, fail = 0;
    for (const jid of targetGroups) {
        try {
            if (mediaBuffer) await sock.sendMessage(jid, { image: mediaBuffer, caption: caption || "" }, { quoted: quotedTemplate });
            else await sock.sendMessage(jid, { text: caption }, { quoted: quotedTemplate });
            success++;
        } catch (err) { fail++; }
        await sleep(delay);
    }
    m.reply(`✅ jaser selesai!\ntarget: ${targetGroups.length}\n✅ berhasil: ${success}\n❌ gagal: ${fail}\n🚫 diblacklist: ${groupIds.length - targetGroups.length}`);
}
break;

case "jaserht":
case "jasherht":
case "hidetagjaser": {
    if (!isOwner) return m.reply(mess.owner);
    if (!text && !/image/.test(mime)) return m.reply(`contoh: ${cmd} pesan hidetag\natau kirim gambar dengan caption ${cmd} pesan`);
    const quotedTemplate = {
        key: { remoteJid: 'status@broadcast', participant: '0@s.whatsapp.net' },
        message: { newsletterAdminInviteMessage: { newsletterJid: `120363402625644245@newsletter`, newsletterName: `© Script by Fyxzpedia`, caption: `Script by Fyxzpedia`, inviteExpiration: 0 } }
    };
    let mediaBuffer = null;
    let caption = text;
    if (/image/.test(mime)) {
        mediaBuffer = await (m.quoted ? m.quoted.download() : m.download());
        caption = text;
    }
    const allGroups = await sock.groupFetchAllParticipating();
    const groupIds = Object.keys(allGroups);
    const blacklist = global.db.settings.blacklistJpm || [];
    const targetGroups = groupIds.filter(id => !blacklist.includes(id));
    const delay = global.db.settings.delayJaser || 4000;
    if (targetGroups.length === 0) return m.reply("❌ tidak ada grup target.");
    await m.reply(`🚀 hidetag ke ${targetGroups.length} grup\npesan: ${caption || "tanpa teks"}\njeda: ${delay} ms`);
    let success = 0, fail = 0;
    for (const jid of targetGroups) {
        try {
            const metadata = await sock.groupMetadata(jid);
            const participants = metadata.participants.map(p => p.id);
            if (mediaBuffer) await sock.sendMessage(jid, { image: mediaBuffer, caption: caption || "", mentions: participants }, { quoted: quotedTemplate });
            else await sock.sendMessage(jid, { text: caption, mentions: participants }, { quoted: quotedTemplate });
            success++;
        } catch (err) { fail++; }
        await sleep(delay);
    }
    m.reply(`✅ hidetag jaser selesai!\ntarget: ${targetGroups.length}\n✅ berhasil: ${success}\n❌ gagal: ${fail}`);
}
break;

case "jedajaser": {
    if (!isOwner) return m.reply(mess.owner);
    if (!text) {
        const currentDelay = global.db.settings.delayJaser || 4000;
        return m.reply(`⏱️ jeda saat ini: ${currentDelay} ms (${currentDelay/1000} detik)\n\nubah: ${cmd} 5000ms\nminimal 1000ms`);
    }
    const match = text.match(/^(\d+)\s*ms$/i);
    if (!match) return m.reply(`format salah!\ncontoh: ${cmd} 5000ms (jeda 5 detik)\nminimal 1000ms`);
    let delay = parseInt(match[1]);
    if (delay < 1000) return m.reply("❌ jeda minimal 1000ms (1 detik)");
    global.db.settings.delayJaser = delay;
    m.reply(`✅ jeda .jaser diubah menjadi *${delay} ms* (${delay/1000} detik).`);
}
break;

case "bljaser": {
    if (!isOwner) return m.reply(mess.owner);
    const groups = await sock.groupFetchAllParticipating();
    const groupList = Object.values(groups);
    const blacklist = global.db.settings.blacklistJpm || [];
    const available = groupList.filter(g => !blacklist.includes(g.id));
    if (available.length === 0) return m.reply("✅ semua grup sudah masuk blacklist jpm.");
    let rows = available.map(g => ({ title: g.subject || "tanpa nama", description: `id: ${g.id} | 👥 ${g.participants.length} member`, id: `.bljaser-add ${g.id}|${g.subject || "tanpa nama"}` }));
    const msg = await generateWAMessageFromContent(m.chat, {
        viewOnceMessage: {
            message: {
                interactiveMessage: {
                    body: { text: `🔴 tambah blacklist jaser (jpm)\npilih grup:\n\nsisa: ${available.length}` },
                    nativeFlowMessage: {
                        buttons: [{ name: "single_select", buttonParamsJson: JSON.stringify({ title: "daftar grup tersedia", sections: [{ title: "pilih grup", rows }] }) }]
                    }
                }
            }
        }
    }, { userJid: m.sender, quoted: m });
    await sock.relayMessage(m.chat, msg.message, { messageId: msg.key.id });
}
break;

case "bljaser-add": {
    if (!isOwner) return;
    if (!text) return;
    const [id, name] = text.split("|").map(s => s.trim());
    if (!id || !name) return m.reply("data tidak valid.");
    if (!global.db.settings.blacklistJpm) global.db.settings.blacklistJpm = [];
    if (global.db.settings.blacklistJpm.includes(id)) return m.reply(`❌ grup *${name}* sudah ada di blacklist.`);
    global.db.settings.blacklistJpm.push(id);
    m.reply(`✅ grup *${name}* ditambahkan ke blacklist.`);
}
break;

case "delbljaser": {
    if (!isOwner) return m.reply(mess.owner);
    const blacklist = global.db.settings.blacklistJpm || [];
    if (blacklist.length === 0) return m.reply("📭 tidak ada grup dalam blacklist.");
    const groups = await sock.groupFetchAllParticipating();
    const groupList = Object.values(groups);
    let rows = [{ title: "hapus semua", description: "hapus semua grup dari blacklist", id: `.delbljaser-response all` }];
    for (let id of blacklist) {
        let grup = groupList.find(g => g.id === id);
        let name = grup ? (grup.subject || "unknown") : "unknown (tidak ditemukan)";
        rows.push({ title: name, description: `id: ${id}`, id: `.delbljaser-response ${id}|${name}` });
    }
    const msg = await generateWAMessageFromContent(m.chat, {
        viewOnceMessage: {
            message: {
                interactiveMessage: {
                    body: { text: `🟢 hapus blacklist jaser (jpm)\npilih grup:\n\ntotal blacklist: ${blacklist.length}` },
                    nativeFlowMessage: {
                        buttons: [{ name: "single_select", buttonParamsJson: JSON.stringify({ title: "daftar blacklist", sections: [{ title: "pilih grup", rows }] }) }]
                    }
                }
            }
        }
    }, { userJid: m.sender, quoted: m });
    await sock.relayMessage(m.chat, msg.message, { messageId: msg.key.id });
}
break;

case "delbljaser-response": {
    if (!isOwner) return;
    if (!text) return;
    if (!global.db.settings.blacklistJpm) global.db.settings.blacklistJpm = [];
    const blacklist = global.db.settings.blacklistJpm;
    if (text === "all") {
        global.db.settings.blacklistJpm = [];
        return m.reply("✅ semua grup dihapus dari blacklist.");
    }
    if (text.includes("|")) {
        const [id, name] = text.split("|").map(s => s.trim());
        if (!blacklist.includes(id)) return m.reply(`❌ grup *${name}* tidak ada dalam blacklist.`);
        global.db.settings.blacklistJpm = blacklist.filter(g => g !== id);
        return m.reply(`✅ grup *${name}* dihapus dari blacklist.`);
    }
}
break;

case "autojoingc": {
    if (!isOwner) return m.reply(mess.owner);
    const sub = args[0]?.toLowerCase();
    if (sub === 'on') {
        global.db.settings.autoJoinGC.enabled = true;
        m.reply('✅ auto join grup diaktifkan');
    } else if (sub === 'off') {
        global.db.settings.autoJoinGC.enabled = false;
        m.reply('✅ auto join grup dimatikan');
    } else if (sub === 'status') {
        m.reply(`status auto join grup\nnyala: ${global.db.settings.autoJoinGC.enabled ? '✅' : '❌'}`);
    } else {
        m.reply(`penggunaan auto join grup\n• ${cmd} on\n• ${cmd} off\n• ${cmd} status`);
    }
}
break;

case "backupsc":
case "bck":
case "backup": {
    if (!isOwner) return m.reply(mess.owner);
    try {
        const tmpDir = "./sampah";
        if (fs.existsSync(tmpDir)) {
            const files = fs.readdirSync(tmpDir).filter(f => f !== "Fyxzpedia");
            for (let file of files) fs.unlinkSync(`${tmpDir}/${file}`);
        }
        await m.reply("backup script bot, tunggu...");
        const name = global.botName || "Backup";
        const exclude = ["node_modules", "config", "Session", "session", "Fyxz", "package-lock.json", "yarn.lock", ".npm", ".cache", ".git", "sampah", "database.json"];
        const allItems = fs.readdirSync(".", { withFileTypes: true });
        const filesToZip = allItems.filter(item => !exclude.includes(item.name)).map(item => item.name);
        if (!filesToZip.length) return m.reply("tidak ada file untuk di-backup.");
        const excludeArgs = exclude.map(e => `-x "${e}/*"`).join(" ");
        execSync(`zip -r ${name}.zip ${filesToZip.join(" ")} ${excludeArgs}`);
        await sock.sendMessage(m.sender, { document: fs.readFileSync(`./${name}.zip`), fileName: `${name}.zip`, mimetype: "application/zip", caption: `backup script - ${global.botName || "Backup"}` }, { quoted: m });
        fs.unlinkSync(`./${name}.zip`);
        if (m.chat !== m.sender) m.reply("✅ script bot dikirim ke private chat.");
    } catch (err) {
        console.error(err);
        m.reply("❌ terjadi kesalahan saat backup.");
    }
}
break;

case "swgrupall": {
    if (!isOwner) return m.reply(mess.owner);
    let storyText = "";
    let mediaBuffer = null;
    let mediaType = null;
    if (/image/.test(mime)) {
        mediaBuffer = await (m.quoted ? m.quoted.download() : m.download());
        mediaType = 'image';
        storyText = text;
    } else if (/video/.test(mime)) {
        mediaBuffer = await (m.quoted ? m.quoted.download() : m.download());
        mediaType = 'video';
        storyText = text;
    } else {
        storyText = text;
    }
    if (!storyText && !mediaBuffer) return m.reply(`kirim teks atau gambar/video dengan caption .swgrupall`);
    await m.reply("⏳ mengirim story ke semua grup...");
    try {
        const groups = await sock.groupFetchAllParticipating();
        const groupIds = Object.keys(groups);
        if (groupIds.length === 0) return m.reply("❌ bot tidak bergabung di grup manapun.");
        const bgColors = ["#FF5733", "#33FF57", "#3357FF", "#F033FF", "#FF33F0", "#33FFF0", "#F0FF33", "#FF8333", "#8333FF", "#33FF83"];
        let success = 0, failed = 0;
        let mediaUrl = null;
        if (mediaBuffer) {
            const ext = mediaType === 'image' ? 'image.jpg' : 'video.mp4';
            mediaUrl = await global.UploadMedia(mediaBuffer, ext, mediaType);
            if (!mediaUrl) throw new Error(`upload ${mediaType} gagal`);
        }
        for (const jid of groupIds) {
            try {
                let content;
                if (mediaUrl && mediaType === 'image') content = { image: { url: mediaUrl }, caption: storyText || undefined };
                else if (mediaUrl && mediaType === 'video') content = { video: { url: mediaUrl }, caption: storyText || undefined, gifPlayback: false };
                else content = { text: storyText, backgroundColor: bgColors[Math.floor(Math.random() * bgColors.length)], font: Math.floor(Math.random() * 7) + 1 };
                const inside = await generateWAMessageContent(content, { upload: sock.waUploadToServer || (async (buf) => ({ url: await global.UploadMedia(buf, 'temp') })), logger: sock.logger });
                const messageSecret = crypto.randomBytes(32);
                const msg = await generateWAMessageFromContent(jid, { messageContextInfo: { messageSecret }, groupStatusMessageV2: { message: { ...inside, messageContextInfo: { messageSecret } } } }, { userJid: m.sender });
                await sock.relayMessage(jid, msg.message, { messageId: msg.key.id });
                success++;
                await sleep(2000);
            } catch (err) { failed++; }
        }
        m.reply(`✅ story selesai dikirim!\ntotal grup: ${groupIds.length}\n✅ berhasil: ${success}\n❌ gagal: ${failed}`);
    } catch (err) {
        console.error(err);
        m.reply("❌ terjadi kesalahan: " + err.message);
    }
}
break;

default:
    // list manager
    if (command && !command.startsWith(global.prefix)) {
        const lists = global.db.settings.lists || {};
        const listData = lists[command];
        if (listData) {
            let caption = listData.text || "📄 tidak ada teks";
            if (listData.media) {
                const mediaBuffer = Buffer.from(listData.media.data, 'base64');
                const mediaType = listData.media.type;
                if (mediaType === 'image') await sock.sendMessage(m.chat, { image: mediaBuffer, caption: caption }, { quoted: m });
                else if (mediaType === 'video') await sock.sendMessage(m.chat, { video: mediaBuffer, caption: caption }, { quoted: m });
            } else {
                await sock.sendMessage(m.chat, { text: caption }, { quoted: m });
            }
            break;
        }
    }
    
    // ========== EVAL / EXEC (HANYA UNTUK OWNER) ==========
    if (m.body.toLowerCase().startsWith("xx ")) {
        if (!isOwner) return m.reply(mess.owner);
        try {
            let code = m.body.slice(3);
            let result = eval(code);
            if (typeof result !== 'string') result = util.inspect(result);
            await m.reply(result.slice(0, 2000));
        } catch (e) {
            await m.reply(String(e));
        }
        break;
    }
    if (m.body.toLowerCase().startsWith("x ")) {
        if (!isOwner) return m.reply(mess.owner);
        try {
            let code = m.body.slice(2);
            exec(code, async (error, stdout, stderr) => {
                if (error) await m.reply(error.message);
                else if (stderr) await m.reply(stderr);
                else await m.reply(stdout.slice(0, 2000));
            });
        } catch (e) {
            await m.reply(String(e));
        }
        break;
    }
    if (m.body.startsWith('$ ')) {
        if (!isOwner) return m.reply(mess.owner);
        try {
            let command = m.body.slice(2);
            let output = execSync(command).toString();
            await m.reply(output.slice(0, 2000));
        } catch (e) {
            await m.reply(String(e));
        }
        break;
    }
    break;
}

// auto join grup (di luar switch)
if (global.db.settings.autoJoinGC?.enabled && m.body) {
    // logika auto join grup (jika ada)
}

}; // penutup module.exports

let file = require.resolve(__filename);
fs.watchFile(file, () => {
    fs.unwatchFile(file);
    delete require.cache[file];
    require(file);
});