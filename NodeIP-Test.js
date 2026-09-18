/**
 * 网络信息（可配置参数版）
 */

function parseArg() {
  const out = {};
  try {
    if (typeof $argument === "string" && $argument.trim()) {
      $argument.split("&").forEach((pair) => {
        const i = pair.indexOf("=");
        if (i === -1) return;
        const k = decodeURIComponent(pair.slice(0, i)).trim();
        let v = decodeURIComponent(pair.slice(i + 1) || "").trim();
        // 未替换的模板忽略
        if (v.includes("{") && v.includes("}")) v = "";
        if (k) out[k] = v;
      });
    }
  } catch (e) {}
  return out;
}

const ARG = parseArg();

function flag(key, def) {
  const v = ARG[key];
  if (v === undefined || v === "") return def;
  return v === "1" || v === "true" || v === "TRUE";
}

function argStr(key, def) {
  const v = ARG[key];
  if (v === undefined || v === "") return def;
  return v;
}

const CFG = {
  group: argStr("group", argStr("GROUP", "Proxy")),
  panelTitle: argStr("PANEL_TITLE", "网络信息"),
  icon: argStr("ICON", "network"),
  iconColor: argStr("ICON_COLOR", "#34C759"),
  showNetwork: flag("SHOW_NETWORK", true),
  showProxyIsp: flag("SHOW_PROXY_ISP", true),
  showLanding: flag("SHOW_LANDING", true),
  showAttr: flag("SHOW_ATTR", true),
  showScore: flag("SHOW_SCORE", true),
  showLoc: flag("SHOW_LOC", true),
  showTz: flag("SHOW_TZ", true),
  showAsn: flag("SHOW_ASN", true),
  showRefresh: flag("SHOW_REFRESH", true),
  maskIp: flag("MASK_IP", false),
};

const BUILTIN = new Set([
  "DIRECT",
  "REJECT",
  "REJECT-DROP",
  "REJECT-TINYGIF",
  "REJECT-NO-DROP",
  "Proxy",
]);

function scoreLevel(score) {
  if (score == null) return { text: "未知", color: CFG.iconColor || "#8E8E93" };
  if (score <= 15) return { text: "极度纯净", color: "#34C759" };
  if (score <= 25) return { text: "安全", color: "#30D158" };
  if (score <= 40) return { text: "较干净", color: "#FFCC00" };
  if (score <= 50) return { text: "轻度风险", color: "#FF9F0A" };
  if (score <= 70) return { text: "中度风险", color: "#FF9500" };
  return { text: "高度风险", color: "#FF3B30" };
}

function nowText() {
  const d = new Date();
  const p = (n) => (n < 10 ? "0" + n : "" + n);
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function maskIP(ip) {
  if (!ip || !CFG.maskIp) return ip;
  if (ip.includes(":")) {
    // IPv6 简单打码
    const parts = ip.split(":");
    return parts.map((p, i) => (i > 1 && i < parts.length - 1 ? "*" : p)).join(":");
  }
  const p = ip.split(".");
  if (p.length === 4) return `${p[0]}.${p[1]}.*.*`;
  return ip;
}

function httpGet(url) {
  return new Promise((resolve) => {
    $httpClient.get(
      {
        url,
        timeout: 8,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
          Accept: "application/json,text/plain,*/*",
        },
      },
      (err, resp, body) => {
        if (err) resolve({ ok: false, err: String(err) });
        else resolve({ ok: true, body: body || "" });
      }
    );
  });
}

function getLocalNetwork() {
  const net = typeof $network !== "undefined" && $network ? $network : {};
  const wifi = net.wifi || net["Wi-Fi"] || null;
  const ssid = (wifi && (wifi.ssid || wifi.SSID)) || "";
  const iface =
    (net.v4 && net.v4.primaryInterface) ||
    (net.v6 && net.v6.primaryInterface) ||
    "";
  const onWifi = !!(ssid || /^en\d/i.test(iface));

  const cell =
    net.cellular || net["cellular"] || net["cellular-data"] || net.radio || {};

  let carrier =
    cell.carrier ||
    cell.carrierName ||
    cell["carrier-name"] ||
    cell.isp ||
    cell.provider ||
    net.carrier ||
    "";

  let radio =
    cell.radio ||
    cell.radioAccessTechnology ||
    cell["radio-tech"] ||
    cell.technology ||
    cell.rat ||
    net.radioTechnology ||
    net["radio-tech"] ||
    "";

  radio = normalizeRadio(String(radio || ""));

  return {
    isWifi: onWifi && !!ssid,
    isCellular: !ssid,
    ssid: ssid || "",
    carrier: carrier || "",
    radio: radio || "",
  };
}

function normalizeRadio(raw) {
  if (!raw) return "";
  const s = raw.toUpperCase();
  if (/NRNSA|NSA|5G\s*NSA/.test(s)) return "5G NSA";
  if (/NR|SA|5G\s*SA|NRSA/.test(s)) return "5G SA";
  if (/LTE|4G/.test(s)) return "LTE";
  if (/WCDMA|HSPA|3G|UMTS/.test(s)) return "3G";
  if (/EDGE|GPRS|2G|GSM/.test(s)) return "2G";
  if (/^(LTE|5G|NSA|SA|NR)/i.test(raw)) return raw;
  return raw;
}

function pickSelected(list) {
  if (!Array.isArray(list)) return null;
  for (const p of list) {
    if (!p || typeof p !== "object") continue;
    if (
      p.isSelected === true ||
      p.isSelectd === true ||
      p.selected === true ||
      p.isSelect === true
    ) {
      return p.name || null;
    }
  }
  return null;
}

function resolveFinalNode(groups, startGroup) {
  if (!groups || typeof groups !== "object") return null;
  let current = startGroup;
  const visited = new Set();
  while (current && !visited.has(current)) {
    visited.add(current);
    const list = groups[current];
    if (!list) return current;
    const selected = pickSelected(list);
    if (!selected) return null;
    if (groups[selected]) current = selected;
    else return selected;
  }
  return null;
}

function getNodeName() {
  return new Promise((resolve) => {
    const root = CFG.group;
    $httpAPI("GET", "/v1/policy_groups", null, (groups) => {
      let resolved = null;
      try {
        if (groups && typeof groups === "object") {
          resolved = resolveFinalNode(groups, root);
        }
      } catch (e) {}

      if (resolved && !BUILTIN.has(resolved) && resolved !== root) {
        resolve(resolved);
        return;
      }

      $httpAPI("GET", "/v1/requests/recent", null, (data) => {
        try {
          const list = Array.isArray(data) ? data : data && data.requests;
          if (Array.isArray(list)) {
            for (const r of list) {
              if (!r) continue;
              const p = r.policyName || r.policy || r.finalPolicy;
              if (
                p &&
                typeof p === "string" &&
                !BUILTIN.has(p) &&
                p !== root
              ) {
                resolve(p);
                return;
              }
            }
          }
        } catch (e) {}
        resolve(resolved || root);
      });
    });
  });
}

async function getCellularMeta() {
  try {
    const r = await httpGet("https://api.bilibili.com/x/web-interface/zone");
    if (r.ok) {
      const j = JSON.parse(r.body);
      const d = j && j.data;
      if (d) {
        const isp = d.isp || "";
        const region = [d.province, d.city].filter(Boolean);
        const uniq = [];
        for (const x of region) {
          if (x && !uniq.includes(x)) uniq.push(x);
        }
        return { isp, area: uniq.join(" ") };
      }
    }
  } catch (e) {}

  try {
    const r = await httpGet("https://myip.ipip.net/json");
    if (r.ok) {
      const j = JSON.parse(r.body);
      const loc = (j && j.data && j.data.location) || [];
      if (Array.isArray(loc) && loc.length) {
        let isp = "";
        let areaParts = [];
        for (const x of loc) {
          if (!x) continue;
          if (/电信|联通|移动|广电|铁通|教育网/.test(x)) isp = x;
          else if (!/中国|中华人民共和国/.test(x)) areaParts.push(x);
        }
        return { isp, area: areaParts.join(" ") };
      }
    }
  } catch (e) {}

  return { isp: "", area: "" };
}

async function getLandingV4() {
  try {
    const r = await httpGet("https://api-ipv4.ip.sb/geoip");
    if (r.ok) {
      const j = JSON.parse(r.body);
      return {
        ip: j.ip || j.address || "",
        loc: [j.country, j.region, j.city].filter(Boolean).join(" · "),
        isp: j.isp || j.organization || j.org || "",
        asn: j.asn != null ? `AS${j.asn}` : "",
        org: j.organization || j.org || "",
        timezone: j.timezone || j.time_zone || "",
      };
    }
  } catch (e) {}

  try {
    const r = await httpGet("http://ip-api.com/json?lang=zh-CN");
    if (r.ok) {
      const j = JSON.parse(r.body);
      if (j.status === "success") {
        return {
          ip: j.query || "",
          loc: [j.country, j.regionName, j.city].filter(Boolean).join(" · "),
          isp: j.isp || j.org || "",
          asn: j.as || "",
          org: j.org || "",
          timezone: j.timezone || "",
        };
      }
    }
  } catch (e) {}

  return { ip: "", loc: "", isp: "", asn: "", org: "", timezone: "" };
}

async function getIPPure() {
  try {
    const r = await httpGet("https://my.ippure.com/v1/info");
    if (r.ok) {
      const info = JSON.parse(r.body);
      return {
        ip: info.ip || "",
        score: info.fraudScore,
        residential: !!info.isResidential,
        broadcast: !!info.isBroadcast,
        loc: [info.country, info.region, info.city].filter(Boolean).join(" · "),
        asn: info.asn != null ? `AS${info.asn}` : "",
        org: info.asOrganization || "",
        timezone: info.timezone || "",
      };
    }
  } catch (e) {}
  return null;
}

(async () => {
  const local = getLocalNetwork();

  const tasks = [getNodeName(), getLandingV4(), getIPPure()];
  if (local.isCellular && CFG.showNetwork) tasks.push(getCellularMeta());

  const results = await Promise.all(tasks);
  const nodeName = results[0];
  const landing = results[1];
  const pure = results[2];
  const cellMeta =
    local.isCellular && CFG.showNetwork
      ? results[3] || { isp: "", area: "" }
      : { isp: "", area: "" };

  const level = scoreLevel(pure && pure.score);

  const type =
    pure != null ? (pure.residential ? "住宅 IP" : "机房 IP") : "";
  const source =
    pure != null ? (pure.broadcast ? "广播 IP" : "原生 IP") : "";

  let scoreText = "未知";
  if (pure && pure.score != null) {
    scoreText = `${pure.score}%  ${level.text}`;
  } else if (pure && pure.ip && String(pure.ip).includes(":")) {
    scoreText = "未知（IPPure 对 IPv6 不评分）";
  }

  const loc = (pure && pure.loc) || landing.loc || "";
  const tz = (pure && pure.timezone) || landing.timezone || "";
  const proxyIsp = landing.isp || landing.org || (pure && pure.org) || "";

  const asnLine =
    pure && (pure.asn || pure.org)
      ? [pure.asn, pure.org].filter(Boolean).join(" - ")
      : [landing.asn, landing.org].filter(Boolean).join(" - ");

  const lines = [];
  lines.push(`节点：${nodeName || "未知"}`);

  if (CFG.showNetwork) {
    if (local.isWifi) {
      lines.push(
        local.ssid ? `网络：Wi-Fi · ${local.ssid}` : "网络：Wi-Fi"
      );
    } else {
      const cellIsp = local.carrier || cellMeta.isp || "";
      const area = cellMeta.area || "";
      const radio = local.radio || "";
      const parts = ["蜂窝"];
      if (cellIsp) parts.push(cellIsp);
      if (area) parts.push(area);
      if (radio) parts.push(radio);
      lines.push(`网络：${parts.join(" · ")}`);
    }
  }

  if (CFG.showProxyIsp && proxyIsp) lines.push(`代理ISP：${proxyIsp}`);

  if (CFG.showLanding) {
    if (landing.ip) lines.push(`落地：${maskIP(landing.ip)}`);
    else if (pure && pure.ip) lines.push(`出口：${maskIP(pure.ip)}`);
  }

  if (CFG.showAttr && type && source) {
    lines.push(`属性：${type}  |  ${source}`);
  }
  if (CFG.showScore) lines.push(`纯净度：${scoreText}`);
  if (CFG.showLoc && loc) lines.push(`位置：${loc}`);
  if (CFG.showTz && tz) lines.push(`时区：${tz}`);
  if (CFG.showAsn && asnLine) lines.push(`ASN：${asnLine}`);
  if (CFG.showRefresh) lines.push(`刷新：${nowText()}`);

  $done({
    title: CFG.panelTitle || "网络信息",
    content: lines.filter(Boolean).join("\n"),
    icon: local.isWifi ? "wifi" : "antenna.radiowaves.left.and.right",
    "icon-color": level.color,
  });
})().catch((e) => {
  $done({
    title: CFG.panelTitle || "网络信息",
    content: `出错：${e}\n刷新：${nowText()}`,
    icon: "xmark.octagon",
    "icon-color": "#FF3B30",
  });
});
