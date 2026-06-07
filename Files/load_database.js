async function LoadDataBase(conn, m) {
  try {
    if (typeof global.db.users !== 'object') global.db.users = {};
    if (typeof global.db.groups !== 'object') global.db.groups = {};
    if (typeof global.db.settings !== 'object') global.db.settings = {};

    // Default settings
    if (typeof global.db.settings.namaSaveContact !== 'string') global.db.settings.namaSaveContact = "Customer";
    if (typeof global.db.settings.jedaPushkontak !== 'number') global.db.settings.jedaPushkontak = 2000;
    if (typeof global.db.settings.lists !== 'object') global.db.settings.lists = {};
    if (typeof global.db.settings.blacklistJpm !== 'object') global.db.settings.blacklistJpm = [];
    if (typeof global.db.settings.delayJaser !== 'number') global.db.settings.delayJaser = 4000;
    if (typeof global.db.settings.thumbnailmenu !== 'string') global.db.settings.thumbnailmenu = global.thumbnailmenu;
    if (typeof global.db.settings.paymentImage !== 'string') global.db.settings.paymentImage = global.paymentImage;
    if (typeof global.db.settings.mode !== 'string') global.db.settings.mode = "public";
    
    // Autojpm
    if (typeof global.db.settings.autojpm !== 'object') global.db.settings.autojpm = {};
    const defaultAutoJpm = {
      enabled: false,
      message: 'Halo ini pesan otomatis',
      media: null,
      interval: 60,
      lastRun: 0,
      blacklist: []
    };
    for (let key in defaultAutoJpm) {
      if (!(key in global.db.settings.autojpm)) global.db.settings.autojpm[key] = defaultAutoJpm[key];
    }

    // AutoJoinGC
    if (typeof global.db.settings.autoJoinGC !== 'object') global.db.settings.autoJoinGC = {};
    const defaultAutoJoin = { enabled: false };
    for (let key in defaultAutoJoin) {
      if (!(key in global.db.settings.autoJoinGC)) global.db.settings.autoJoinGC[key] = defaultAutoJoin[key];
    }

    // Auto story grup (autojpmswgc)
    if (typeof global.db.settings.autojpmswgc !== 'object') global.db.settings.autojpmswgc = {};
    const defaultAutoSwgc = {
      enabled: false,
      message: 'Halo ini story otomatis',
      media: null,
      interval: 60,
      lastRun: 0,
      blacklist: []
    };
    for (let key in defaultAutoSwgc) {
      if (!(key in global.db.settings.autojpmswgc)) global.db.settings.autojpmswgc[key] = defaultAutoSwgc[key];
    }

    // User default
    if (typeof global.db.users[m.sender] !== 'object') global.db.users[m.sender] = {};
    const defaultUser = { premium: false };
    for (let key in defaultUser) {
      if (!(key in global.db.users[m.sender])) global.db.users[m.sender][key] = defaultUser[key];
    }

    // Group default
    if (m.isGroup) {
      if (typeof global.db.groups[m.chat] !== 'object') global.db.groups[m.chat] = {};
      const defaultGroup = { antilink: false, antilink2: false, autopromosi: false, welcome: false };
      for (let key in defaultGroup) {
        if (!(key in global.db.groups[m.chat])) global.db.groups[m.chat][key] = defaultGroup[key];
      }
    }
  } catch (e) {
    throw e;
  }
}

module.exports = LoadDataBase;