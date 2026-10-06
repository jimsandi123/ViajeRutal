/* ============================================================
   VIAJE RURAL — Firebase + Leaflet + GPS en tiempo real
   Asignación secuencial por cercanía y tipo de vehículo,
   PWA, buscador Nominatim (Costa Rica), WhatsApp y panel admin.
   ============================================================ */

// ---------- Firebase ----------
const firebaseConfig = {
  apiKey: "AIzaSyBSrq5uQcZDTVA8Io7N4eLtzVoHYcmm3eE",
  authDomain: "viajerural-60244.firebaseapp.com",
  databaseURL: "https://viajerural-60244-default-rtdb.firebaseio.com",
  projectId: "viajerural-60244",
  storageBucket: "viajerural-60244.firebasestorage.app",
  messagingSenderId: "959903976534",
  appId: "1:959903976534:web:9b2ffea65adca763b37ff7",
  measurementId: "G-Q6NN87H6FN",
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database().ref();

const SECURE_KEY = "SECURE_KEY_2026";
const ADMIN_PASS = "Jimsan1980";
const DIA = 86400000;
const SOPORTE_WA = "50662546546"; // número WhatsApp del administrador
const TIEMPO_RESPUESTA = 15000;   // 15 segundos para aceptar la oferta
const RADIO_CERCA = 5;            // radio de búsqueda para conductores disponibles
const DIST_PROXIMIDAD = 0.6;      // km para alerta de proximidad
const DEFAULT_TARIFA = 1000;
const iconoAvatarFallback = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#e0e0e0" rx="32"/><text x="32" y="42" font-size="30" text-anchor="middle">👤</text></svg>');

function genPin() { return String(Math.floor(100 + Math.random() * 900)); } // PIN de 3 dígitos

function waTel(num, texto) {
  window.open(`https://api.whatsapp.com/send?phone=${num}&text=${encodeURIComponent(texto)}`, "_blank");
}
function waSoporte(texto) { waTel(SOPORTE_WA, texto); }
function compartirAplicacion() {
  const enlace = "https://ViajeRural.on.websim.com";
  window.open(`https://wa.me/?text=${encodeURIComponent(`Viaja con Viaje Rural. Descarga y comparte la aplicación: ${enlace}`)}`, "_blank");
}

let usuario = null;

// ---------- Utilidades ----------
const $ = (id) => document.getElementById(id);
$("btnCompartirPas").addEventListener("click", compartirAplicacion);
$("btnCompartirCond").addEventListener("click", compartirAplicacion);
const genId = () => "USR-" + Math.floor(10000 + Math.random() * 90000);
const daysUntil = (ts) => Math.max(0, Math.ceil((ts - Date.now()) / DIA));
function diasDeAqui(n) { const d = new Date(); d.setDate(d.getDate() + n); return d.getTime(); }
function darFechaLarga(ts) { return new Date(ts).toLocaleDateString("es-CR", { day: "2-digit", month: "long", year: "numeric" }); }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function msg(el, txt, tipo) {
  el.textContent = txt;
  el.className = "feedback" + (tipo ? " " + tipo : "");
}
function beepAlert() {
  try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (e) {}
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = "sine"; o.frequency.value = 880;
    g.gain.setValueAtTime(0.4, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    o.start();
    o.stop(ctx.currentTime + 0.6);
  } catch (e) {}
}

// ---------- Limpiar sesión ----------
function limpiarSesion() {
  detenerViajesConductor();
  detenerChat();
  detenerSeguimientoConductor();
  detenerConductoresCerca();
  detenerAvanceOferta();
  detenerAlertaTiempo();
  if (viajeEscuchadoRef && viajeEscuchadoCb) viajeEscuchadoRef.off("value", viajeEscuchadoCb);
  viajeEscuchadoRef = null; viajeEscuchadoCb = null;
  if (watchId) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  if (gpsTimer) { clearInterval(gpsTimer); gpsTimer = null; }
  if (usuario?.id && usuario.rol === "conductor") db.child("ubicaciones").child(usuario.id).update({ online: false });
  usuario = null;
}

// ---------- Persistencia de sesión (requerimiento 11) ----------
function guardarSesion() {
  if (!usuario) return;
  localStorage.setItem("miSesion", JSON.stringify({ rol: usuario.rol, id: usuario.id, nombre: usuario.nombre }));
}
function borrarSesionGrabada() {
  localStorage.removeItem("miSesion");
  localStorage.removeItem("miConductorId");
  localStorage.removeItem("miViaje");
  localStorage.removeItem("miPasajero");
}
function salirTodo() {
  limpiarSesion();
  borrarSesionGrabada();
  location.reload();
}
// Al abrir: restaurar sesión guardada sin volver a pedir clave
function restaurarSesion() {
  try {
    const s = JSON.parse(localStorage.getItem("miSesion") || "null");
    if (!s) return;
    if (s.rol === "conductor") {
      db.child("conductores").child(s.id).once("value", (snap) => {
        const c = snap.val();
        if (!c || !c.licenciaExp || daysUntil(c.licenciaExp) <= 0) return;
        usuario = { rol: "conductor", id: c.id, nombre: c.nombre };
        guardarSesion();
        iniciarVistaConductor(c);
      });
    } else if (s.rol === "pasajero") {
      db.child("pasajeros").child(s.id).once("value", (snap) => {
        const p = snap.val();
        if (!p) return;
        usuario = { rol: "pasajero", id: p.id, nombre: p.nombre };
        iniciarVistaPasajero(p);
      });
    } else if (s.rol === "admin") {
      usuario = { rol: "admin", id: "ADMIN", nombre: "Administrador" };
      iniciarVistaAdmin();
    }
  } catch (e) {}
}

// ---------- Leaflet ----------
const iconPasajero = L.icon({ iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png", iconSize: [25, 41], iconAnchor: [12, 41] });
const iconConductor = L.divIcon({ html: '<div class="car-pin">🚗</div>', className: "", iconSize: [34, 34], iconAnchor: [17, 17] });
const iconDestino = L.divIcon({ html: '<div class="dest-pin">🏁</div>', className: "", iconSize: [30, 30], iconAnchor: [15, 30] });

// ============================================================
//              TIPOS DE VEHÍCULO (gestionados por admin)
// ============================================================
let tiposCache = {};
const TIPOS_DEFAULT = {
  auto: { nombre: "Automóvil", icono: "🚗", capacidad: 4 },
  moto: { nombre: "Motocicleta (moto)", icono: "🛵", capacidad: 1 },
  buseta: { nombre: "Buseta", icono: "🚐", capacidad: 15 },
  carga: { nombre: "Pick up / Carga", icono: "🛻", capacidad: 2 },
};

function cargarTiposVehiculo(cb) {
  db.child("tiposVehiculo").once("value", (snap) => {
    const data = snap.val() || {};
    if (Object.keys(data).length === 0) {
      db.child("tiposVehiculo").set(TIPOS_DEFAULT);
      tiposCache = { ...TIPOS_DEFAULT };
    } else {
      tiposCache = data;
    }
    renderSelectsTipo();
    if (cb) cb();
  }, () => {
    tiposCache = { ...TIPOS_DEFAULT };
    renderSelectsTipo();
    if (cb) cb();
  });
}

function renderSelectsTipo() {
  ["admCondTipo", "regConTipo", "edConTipo"].forEach((id) => {
    const sel = $(id);
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">Selecciona tipo</option>';
    Object.entries(tiposCache).forEach(([key, t]) => {
      const op = document.createElement("option");
      op.value = key;
      op.textContent = `${t.icono || "🚗"} ${t.nombre || key}`;
      sel.appendChild(op);
    });
    sel.value = cur;
  });
}

let opcionesTipoCache = {};
function renderOpcTipos(cantidad, opciones = []) {
  const wrap = $("opcTipoWrap");
  const cont = $("opcTipos");
  if (!wrap || !cont) return;
  if (!cantidad || cantidad < 1 || !opciones.length) { wrap.style.display = "none"; cont.innerHTML = ""; return; }
  opcionesTipoCache = Object.fromEntries(opciones.map((o) => [o.key, o]));
  wrap.style.display = "block";
  cont.innerHTML = opciones.map((o) => {
    const nombre = `${o.tipo.icono || "🚗"} ${o.tipo.nombre || o.key} (${o.tipo.capacidad ?? "?"} pax)`;
    return `<label class="tipo-check"><input type="checkbox" value="${escapeHtml(o.key)}"> <span><b>${escapeHtml(nombre)}</b><small>${o.conductores} disponible(s) con capacidad para ${cantidad}+ pasajero(s) · hasta ${RADIO_CERCA} km · Aproximado ₡${o.precio.toLocaleString()}</small></span></label>`;
  }).join("");
}
$("inpCantPasajeros").addEventListener("input", () => {
  invalidarBusquedaVehiculos();
});

// ============================================================
//                        GESTOR DE PANTALLAS
// ============================================================
function ocultarTodo() {
  ["view-login", "view-pasajero", "view-conductor", "view-admin"].forEach((v) => {
    document.getElementById(v).style.display = "none";
  });
  $("licModal").style.display = "none";
}

document.querySelectorAll(".role-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".role-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    const rol = tab.dataset.role;
    document.querySelectorAll(".role-panel").forEach((p) => (p.style.display = "none"));
    $("role-" + rol).style.display = "block";
    $("loginDriverId").style.display = rol === "conductor" ? "block" : "none";
    if (rol === "conductor") actualizarIdLoginConductor($("inpIdConductor").value.trim());
    $("loginMsg").textContent = "";
  });
});

// ============================================================
//                    TÉRMINOS Y CONDICIONES
// ============================================================
function abrirTerminos() { $("terminosModal").style.display = "flex"; }
$("btnTerminosLogin").addEventListener("click", abrirTerminos);
$("btnTerminosPas").addEventListener("click", abrirTerminos);
$("btnCerrarTerminos").addEventListener("click", () => ($("terminosModal").style.display = "none"));

// ---------- Guías de Uso (requerimiento 10) ----------
function abrirGuias(rol) {
  $("guiasModal").style.display = "flex";
  document.querySelectorAll(".guias-panel").forEach((p) => (p.style.display = "none"));
  document.querySelectorAll("[data-gtab]").forEach((t) => t.classList.remove("active"));
  if (rol === "pasajero") {
    $("guias-pasajero").style.display = "block";
    const t = document.querySelector('[data-gtab="pasajero"]'); if (t) t.classList.add("active");
  } else {
    $("guias-conductor").style.display = "block";
    const t = document.querySelector('[data-gtab="conductor"]'); if (t) t.classList.add("active");
  }
}
$("btnGuiasLogin").addEventListener("click", () => abrirGuias("conductor"));
$("btnGuiasPas").addEventListener("click", () => abrirGuias("pasajero"));
$("btnGuiasCond").addEventListener("click", () => abrirGuias("conductor"));
$("btnCerrarGuias").addEventListener("click", () => ($("guiasModal").style.display = "none"));
document.querySelectorAll("[data-gtab]").forEach((t) => {
  t.addEventListener("click", () => {
    document.querySelectorAll(".guias-panel").forEach((p) => (p.style.display = "none"));
    document.querySelectorAll("[data-gtab]").forEach((x) => x.classList.remove("active"));
    t.classList.add("active");
    $("guias-" + t.dataset.gtab).style.display = "block";
  });
});

// ============================================================
//                       PWA / INSTALAR APP
// ============================================================
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const b = $("btnInstalar");
  if (b) b.style.display = "inline-block";
});
$("btnInstalar").addEventListener("click", async () => {
  const b = $("btnInstalar");
  if (deferredPrompt) {
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    b.style.display = "none";
  } else {
    // iOS / navegador sin soporte: mostrar instrucciones
    alert("Para instalar: en el menú del navegador elige «Agregar a pantalla de inicio» / «Instalar app».");
  }
});
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((e) => console.warn("SW:", e));
  });
}

// ============================================================
//                MODAL DE LICENCIA
// ============================================================
let licConductorId = localStorage.getItem("miConductorId") || "";

function abrirModalLic() {
  const id = licConductorId || (usuario?.rol === "conductor" ? usuario.id : "") || "";
  $("miUserId").textContent = id || "----";
  $("inpLicToken").value = "";
  $("licEstado").textContent = "";
  $("licModal").style.display = "flex";
}
$("btnAbrirLicencia").addEventListener("click", abrirModalLic);
$("btnCerrarLic").addEventListener("click", () => ($("licModal").style.display = "none"));

$("btnCopiarId").addEventListener("click", async () => {
  const id = $("miUserId").textContent;
  if (!id || id === "----") { msg($("licEstado"), "No hay ID. Verifica tu clave de conductor.", "err"); return; }
  try { await navigator.clipboard.writeText(id); msg($("licEstado"), "ID copiado: " + id, "ok"); }
  catch { msg($("licEstado"), "ID: " + id, "ok"); }
});

// Renovar licencia por WhatsApp (solo envía el mensaje al administrador)
$("btnWA").addEventListener("click", () => {
  const userId = $("miUserId").textContent;
  const texto = `¡Hola! Deseo renovar mi licencia de conductor en Viaje Rural.\nMi ID de usuario es: ${userId}`;
  waSoporte(texto);
});

$("btnProcesarLicencia").addEventListener("click", () => {
  const raw = $("inpLicToken").value.trim();
  const userIdLocal = $("miUserId").textContent;
  if (!raw) { msg($("licEstado"), "Pega tu enlace o token de activación.", "err"); return; }
  let token = raw;
  const m = raw.match(/#lic=(.+)/) || raw.match(/(?:license_token)[=:]([A-Za-z0-9+/=]+)/);
  if (m) token = m[1];
  let datos;
  try { datos = atob(token); } catch { msg($("licEstado"), "Token inválido.", "err"); return; }
  const s1 = datos.indexOf("_");
  if (s1 <= 0) { msg($("licEstado"), "Token inválido.", "err"); return; }
  const timestampStr = datos.slice(0, s1);
  const rest = datos.slice(s1 + 1);
  const s2 = rest.indexOf("_");
  if (s2 <= 0) { msg($("licEstado"), "Token inválido.", "err"); return; }
  const userIdToken = rest.slice(0, s2);
  const firma = rest.slice(s2 + 1);
  if (firma !== SECURE_KEY || !timestampStr || !userIdToken) { msg($("licEstado"), "Token inválido.", "err"); return; }
  if (userIdToken !== userIdLocal) { msg($("licEstado"), "Este enlace de activación fue generado para otra cuenta y no puede utilizarse aquí.", "err"); return; }
  const ts = parseInt(timestampStr, 10);
  if (ts <= Date.now()) { msg($("licEstado"), "La licencia ya venció.", "err"); return; }
  db.child("conductores").child(userIdLocal).update({ licenciaExp: ts, licenciaDias: daysUntil(ts) })
    .then(() => { msg($("licEstado"), "✅ Licencia actualizada hasta " + darFechaLarga(ts), "ok"); })
    .catch((e) => msg($("licEstado"), "Error: " + e, "err"));
});

if (location.hash.includes("#lic=")) {
  try {
    const tok = location.hash.replace("#lic=", "");
    const [t, uid] = atob(tok).split("_");
    licConductorId = uid;
    localStorage.setItem("miConductorId", uid);
    abrirModalLic();
    $("inpLicToken").value = location.href;
  } catch {}
}

// ============================================================
//                   LOGUEO DE CONDUCTOR  (autenticación estricta: ID/Cédula + clave exacta)
// ============================================================
// Busca al conductor por su ID (path en Firebase) o por su cédula.
function buscarConductorPorCredencial(idOCedula, cb) {
  const valor = String(idOCedula || "").trim();
  if (!valor) return cb(null);
  // 1) Probar como ID de usuario (path)
  db.child("conductores").child(valor).once("value", (snap) => {
    if (snap.exists() && snap.val().id) return cb(snap.val());
    // 2) Probar como cédula exacta
    db.child("conductores").orderByChild("cedula").equalTo(valor).limitToFirst(1).once("value", (s2) => {
      let found = null;
      s2.forEach((it) => { found = it.val(); });
      cb(found);
    });
  });
}

let loginDriverLookup = 0;
function actualizarIdLoginConductor(idOCedula) {
  const valor = String(idOCedula || "").trim();
  const display = $("loginDriverIdValue");
  const requestId = ++loginDriverLookup;
  if (!valor) { display.textContent = "Escribe tu ID o cédula"; return; }
  display.textContent = "Buscando…";
  buscarConductorPorCredencial(valor, (found) => {
    if (requestId !== loginDriverLookup) return;
    display.textContent = found?.id || "No encontrado";
  });
}

function verDiasConductor(idOCedula, clave) {
  const el = $("licDiasCond");
  if (!idOCedula || !clave) {
    el.innerHTML = "🔹 Ingresa tu ID/Cédula y tu clave para ver los días de licencia.";
    el.style.color = "";
    return;
  }
  buscarConductorPorCredencial(idOCedula, (found) => {
    if (!found) { el.innerHTML = "❌ Usuario no encontrado."; el.style.color = "#e0352f"; return; }
    if (found.clave !== clave) { el.innerHTML = "❌ Clave incorrecta."; el.style.color = "#e0352f"; return; }
    licConductorId = found.id; localStorage.setItem("miConductorId", found.id);
    const dl = found.licenciaExp ? daysUntil(found.licenciaExp) : 0;
    if (!found.licenciaExp || dl <= 0) {
      el.innerHTML = "⛔ Tu licencia está <b>vencida</b>. Renueva tu licencia para ingresar.";
      el.style.color = "#e0352f";
    } else {
      el.innerHTML = `✅ Tu licencia vence en <b>${dl} día${dl === 1 ? "" : "s"}</b> (${darFechaLarga(found.licenciaExp)}).`;
      el.style.color = "#00a857";
    }
  });
}
let loginDebounce = null;
$("inpIdConductor").addEventListener("input", (e) => {
  clearTimeout(loginDebounce);
  loginDebounce = setTimeout(() => {
    const identificador = e.target.value.trim();
    actualizarIdLoginConductor(identificador);
    verDiasConductor(identificador, $("inpClaveConductor").value.trim());
  }, 400);
});
$("inpClaveConductor").addEventListener("input", (e) => verDiasConductor($("inpIdConductor").value.trim(), e.target.value.trim()));

$("btnLoginConductor").addEventListener("click", () => {
  const ident = $("inpIdConductor").value.trim();
  const clave = $("inpClaveConductor").value.trim();
  const em = $("loginMsg");
  if (!ident || !clave) { msg(em, "Ingresa tu ID/Cédula y tu clave.", "err"); return; }
  buscarConductorPorCredencial(ident, (c) => {
    if (!c) { msg(em, "Usuario no encontrado. Verifica tu ID o Cédula.", "err"); return; }
    if (c.clave !== clave) { msg(em, "Clave incorrecta. Acceso denegado.", "err"); return; }
    $("btnSolicitarActivacion").style.display = "none";
    if (c.estado === "pendiente") {
      pendCondTmp = { id: c.id, nombre: c.nombre };
      licConductorId = c.id; localStorage.setItem("miConductorId", c.id);
      msg(em, "⏳ Tu cuenta está pendiente de activación por el administrador. Usa el botón para solicitarla por WhatsApp.", "err");
      $("btnSolicitarActivacion").style.display = "block";
      return;
    }
    const dl = c.licenciaExp ? daysUntil(c.licenciaExp) : 0;
    if (!c.licenciaExp || dl <= 0) {
      msg(em, "Tu licencia está vencida. Solo el administrador puede renovarla.", "err");
      return;
    }
    usuario = { rol: "conductor", id: c.id, nombre: c.nombre };
    guardarSesion();
    iniciarVistaConductor(c);
  });
});

let pendCondTmp = null;
$("btnSolicitarActivacion").addEventListener("click", () => {
  const c = pendCondTmp || {};
  const id = c.id || licConductorId || "";
  waSoporte(`¡Hola! Solicito la activación de mi cuenta de conductor en Viaje Rural.\nNombre: ${c.nombre || "—"}\nID de usuario: ${id}`);
});

// ---------- Registro autoservicio de conductor ----------
function cerrarRegCon() { $("regCorModal").style.display = "none"; }
const regFotos = [
  ["regFotPerfil", "previewRegFotPerfil"],
  ["regFotVehiculo", "previewRegFotVehiculo"],
  ["regFotLic", "previewRegFotLic"],
  ["regFotMarch", "previewRegFotMarch"],
  ["regFotDekra", "previewRegFotDekra"],
];
regFotos.forEach(([inputId, previewId]) => {
  $(inputId).addEventListener("change", (event) => {
    const preview = $(previewId);
    preview.replaceChildren();
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const image = document.createElement("img");
      image.src = reader.result;
      image.alt = "Vista previa";
      preview.appendChild(image);
    };
    reader.readAsDataURL(file);
  });
});
$("btnRegConductor").addEventListener("click", () => {
  $("regConMsg").textContent = "";
  ["regConNombre", "regConCedula", "regConTel", "regConEmail", "regConClave", "regConMarca", "regConColor", "regConPlaca"].forEach((i) => ($(i).value = ""));
  regFotos.forEach(([inputId, previewId]) => {
    $(inputId).value = "";
    $(previewId).replaceChildren();
  });
  if (!$("regConTipo").children.length) renderSelectsTipo();
  $("regCorModal").style.display = "flex";
});
$("btnCerrarRegCon").addEventListener("click", cerrarRegCon);

async function subirImagen(file) {
  if (!file) return null;
  if (window.websim && typeof window.websim.upload === "function") {
    try { const u = await window.websim.upload(file); if (u) return u; } catch (e) {}
  }
  return await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

$("btnGuardarRegCon").addEventListener("click", async () => {
  const em = $("regConMsg");
  const nombre = $("regConNombre").value.trim();
  const cedula = $("regConCedula").value.trim();
  const tel = $("regConTel").value.trim();
  const email = $("regConEmail").value.trim();
  const clave = $("regConClave").value.trim();
  const fPerfil = $("regFotPerfil").files[0];
  const fVehiculo = $("regFotVehiculo").files[0];
  const fLic = $("regFotLic").files[0];
  const fMarch = $("regFotMarch").files[0];
  const fDekra = $("regFotDekra").files[0];
  const tipo = $("regConTipo").value;
  const marca = $("regConMarca").value.trim();
  const color = $("regConColor").value.trim();
  const placa = $("regConPlaca").value.trim().toUpperCase();
  const capacidad = parseInt($("regConPasajeros").value, 10) || 4;
  if (!nombre || !cedula || !tel || !clave) { msg(em, "Completa nombre, cédula, teléfono y clave.", "err"); return; }
  if (!tipo) { msg(em, "Selecciona el tipo de vehículo.", "err"); return; }
  if (!marca || !color || !placa) { msg(em, "Completa marca, color y placa del vehículo.", "err"); return; }
  if (!fPerfil || !fVehiculo || !fLic || !fMarch || !fDekra) { msg(em, "Adjunta las fotos: perfil, vehículo (obligatoria), licencia, marchamo y Dekra.", "err"); return; }
  msg(em, "Subiendo documentos, por favor espera...", "ok");
  const btn = $("btnGuardarRegCon"); btn.disabled = true;
  try {
    const [perfil, vehiculo, licencia, marchamo, dekra] = await Promise.all([
      subirImagen(fPerfil), subirImagen(fVehiculo), subirImagen(fLic), subirImagen(fMarch), subirImagen(fDekra),
    ]);
    const id = genId();
    await db.child("conductores").child(id).set({
      id, nombre, cedula, telefono: tel, correo: email, clave, estado: "pendiente", creado: Date.now(),
      tipoVehiculo: tipo, marca, colorVehiculo: color, placa, pasajeros: capacidad,
      fotoPerfil: perfil, fotoVehiculo: vehiculo, fotoLicencia: licencia, fotoMarchamo: marchamo, fotoDekra: dekra,
    });
    pendCondTmp = { id, nombre };
    licConductorId = id; localStorage.setItem("miConductorId", id);
    $("regCorModal").style.display = "none";
    msg($("loginMsg"), "✅ Registro enviado. Tu ID es " + id + ". Tu cuenta quedó en revisión.", "ok");
    $("btnSolicitarActivacion").style.display = "block";
    // Abre WhatsApp con el mensaje predeterminado dirigido al administrador para pedir la activación
    waSoporte(`¡Hola! Acabo de registrarme como conductor en Viaje Rural.\nSolicito la activación de mi cuenta.\nNombre: ${nombre}\nID de usuario: ${id}\nTipo de vehículo: ${(tiposCache[tipo]?.nombre) || tipo}`);
  } catch (e) {
    msg(em, "Error al registrar: " + e, "err");
  } finally {
    btn.disabled = false;
  }
});

// ============================================================
//                       LOGUEO ADMIN
// ============================================================
$("btnLoginAdmin").addEventListener("click", () => {
  const clave = $("inpClaveAdmin").value.trim();
  const em = $("loginMsg");
  if (clave === ADMIN_PASS) {
    usuario = { rol: "admin", id: "ADMIN", nombre: "Administrador" };
    iniciarVistaAdmin();
  } else {
    msg(em, "Clave de administrador incorrecta.", "err");
  }
});

// ============================================================
//                ENTRADA DEL PASAJERO
// ============================================================
$("btnEntrarPasajero").addEventListener("click", () => {
  const guardado = JSON.parse(localStorage.getItem("miPasajero") || "null");
  if (guardado) {
    usuario = { rol: "pasajero", id: guardado.id, nombre: guardado.nombre };
    guardarSesion();
    iniciarVistaPasajero(guardado);
  } else {
    $("view-login").style.display = "none";
    $("view-pasajero").style.display = "block";
    $("regPasajero").style.display = "block";
    $("pasajeroMain").style.display = "none";
  }
});

$("btnGuardarPasajero").addEventListener("click", async () => {
  const nombre = $("regPasNombre").value.trim();
  const tel = $("regPasTel").value.trim();
  const em = $("regPasMsg");
  if (!nombre || !tel) { msg(em, "Completa tu nombre y teléfono.", "err"); return; }
  let foto = null;
  const f = $("regPasFoto").files[0];
  if (f) { msg(em, "Subiendo foto...", "ok"); foto = await subirImagen(f).catch(() => null); }
  const p = { id: genId(), nombre, telefono: tel, creado: Date.now(), favoritos: [], fotoPerfil: foto || "" };
  db.child("pasajeros").child(p.id).set(p);
  localStorage.setItem("miPasajero", JSON.stringify(p));
  usuario = { rol: "pasajero", id: p.id, nombre: p.nombre };
  guardarSesion();
  iniciarVistaPasajero(p);
});

$("btnSalirPasajero").addEventListener("click", salirTodo);

// ============================================================
//               VISTA PASAJERO — MAPA + VIAJE
// ============================================================
let mapPas = null, markerPas = null, markerDestPas = null;
let misViajeId = localStorage.getItem("miViaje") || null;
let viajeEscuchadoRef = null, viajeEscuchadoCb = null;
let miPos = null, orientText = null, destSelecc = null;
let ofertaTimer = null;
let viajeAceptoMostrado = null;
let viajePasajeroActual = null;
let durmiendoProx = false;
let mapOcultaPas = false;

function iniciarVistaPasajero(p) {
  $("view-pasajero").style.display = "block";
  $("view-login").style.display = "none";
  $("regPasajero").style.display = "none";
  $("pasajeroMain").style.display = "block";
  $("pasajeroNombre").textContent = p.nombre;
  $("btnCancelarViaje").style.display = "none";
  $("viajeInfo").style.display = "none";
  $("viajeConductorDetail").innerHTML = "";
  viajeAceptoMostrado = null;
  durmiendoProx = false;
  initMapPasajero();
  ubicarPasajero();
  iniciarConductoresCerca();
  misFavs = Array.isArray(p.favoritos) ? p.favoritos : [];
  renderFavoritos();
  if (misViajeId) {
    db.child("viajes").child(misViajeId).once("value", (s) => {
      if (s.exists()) { escucharMiViaje(s.val()); }
      else { misViajeId = null; localStorage.removeItem("miViaje"); }
    });
  }
}

function initMapPasajero() {
  if (mapPas) { setTimeout(() => mapPas.invalidateSize(), 100); return; }
  mapPas = L.map("mapPasajero").setView([9.9281, -84.0907], 15);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap" }).addTo(mapPas);
}

function invalidarBusquedaVehiculos() {
  opcionesTipoCache = {};
  $("opcTipoWrap").style.display = "none";
  $("opcTipos").innerHTML = "";
  $("btnPedirViaje").style.display = "none";
}

function pinOrigen() {
  if (!miPos) return;
  mapPas.setView([miPos.lat, miPos.lng], 15);
  if (markerPas) mapPas.removeLayer(markerPas);
  markerPas = L.marker([miPos.lat, miPos.lng], { icon: iconPasajero, title: "Origen" }).addTo(mapPas).bindPopup("Origen");
}

function ubicarPasajero() {
  $("origenTxt").textContent = "Detectando tu ubicación GPS...";
  if (!navigator.geolocation) { $("origenTxt").textContent = "GPS no disponible. Busca o selecciona un lugar."; return; }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      miPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      $("inpOrigen").value = "Ubicación actual (GPS)";
      invalidarBusquedaVehiculos();
      pinOrigen();
      cargarOrigenTexto(miPos);
      renderConductoresCerca();
    },
    (err) => {
      if (err.code === 1) $("origenTxt").textContent = "Permiso de ubicación denegado. Usa el buscador para elegir tu origen.";
      else $("origenTxt").textContent = "No se pudo obtener el GPS. Usa el buscador.";
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

function cargarOrigenTexto(pos) {
  fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${pos.lat}&lon=${pos.lng}`)
    .then((r) => r.json())
    .then((j) => { if (j.display_name) {
      $("origenTxt").textContent = j.display_name;
      if ($("inpOrigen").value === "Ubicación actual (GPS)") $("inpOrigen").value = j.display_name;
    } })
    .catch(() => {
      const coords = `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`;
      $("origenTxt").textContent = coords;
      if ($("inpOrigen").value === "Ubicación actual (GPS)") $("inpOrigen").value = coords;
    });
}
$("btnUsarGps").addEventListener("click", () => {
  $("origenTxt").textContent = "Detectando tu ubicación GPS...";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      miPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      $("inpOrigen").value = "Ubicación actual (GPS)";
      invalidarBusquedaVehiculos();
      pinOrigen(); cargarOrigenTexto(miPos); renderConductoresCerca();
    },
    () => $("origenTxt").textContent = "No se pudo obtener el GPS. Usa el buscador.",
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

// Botón flotante: ocultar / mostrar el mapa (requerimiento 5 - pasajero)
$("btnToggleMapaPas").addEventListener("click", () => {
  mapOcultaPas = !mapOcultaPas;
  const el = $("mapPasajero");
  el.style.display = mapOcultaPas ? "none" : "block";
  $("btnToggleMapaPas").textContent = mapOcultaPas ? "🗺️ Ver mapa" : "🗺️ Ocultar mapa";
  if (!mapOcultaPas && mapPas) setTimeout(() => mapPas.invalidateSize(), 100);
});

function cambiarVistaPasajero(tab) {
  document.querySelectorAll("[data-pass-view]").forEach((s) => s.classList.toggle("active", s.dataset.passView === tab));
  document.querySelectorAll("[data-pass-tab]").forEach((b) => b.classList.toggle("active", b.dataset.passTab === tab));
  if (tab === "mapa" && mapPas) setTimeout(() => mapPas.invalidateSize(), 100);
}
document.querySelectorAll("[data-pass-tab]").forEach((b) => b.addEventListener("click", () => cambiarVistaPasajero(b.dataset.passTab)));
$("btnPerfilPasNav").addEventListener("click", () => $("btnAjustesPas").click());

// Cerrar modal de viaje aceptado
$("btnCerrarAcepto").addEventListener("click", () => {
  $("aceptoModal").style.display = "none";
  cambiarVistaPasajero("mapa");
});

// ---------- Búsqueda Nominatim de Costa Rica (countrycodes=cr) ----------
let geoTimer = null;
function buscarNominatim(input, listaId, alSeleccionar) {
  clearTimeout(geoTimer);
  const q = input.value.trim();
  const lista = $(listaId);
  if (q.length < 3) { if (lista) lista.innerHTML = ""; return; }
  geoTimer = setTimeout(() => {
    fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=6&countrycodes=cr&q=${encodeURIComponent(q)}`)
      .then((r) => r.json())
      .then((res) => {
        if (!lista) return;
        lista.innerHTML = "";
        res.forEach((item) => {
          const li = document.createElement("li");
          li.textContent = item.display_name;
          li.onclick = () => {
            alSeleccionar({ lat: parseFloat(item.lat), lng: parseFloat(item.lon), txt: item.display_name });
            lista.innerHTML = "";
          };
          lista.appendChild(li);
        });
      }).catch(() => {});
  }, 450);
}

$("inpOrigen").addEventListener("input", (e) => {
  miPos = null;
  invalidarBusquedaVehiculos();
  $("origenTxt").textContent = "Selecciona una ubicación de la lista.";
  renderConductoresCerca();
  buscarNominatim(e.target, "origenSugerencias", (sel) => {
    miPos = { lat: sel.lat, lng: sel.lng };
    invalidarBusquedaVehiculos();
    $("origenTxt").textContent = sel.txt;
    $("inpOrigen").value = sel.txt;
    pinOrigen(); renderConductoresCerca();
  });
});

$("inpDestino").addEventListener("input", (e) => {
  destSelecc = null;
  invalidarBusquedaVehiculos();
  if (markerDestPas) { mapPas.removeLayer(markerDestPas); markerDestPas = null; }
  buscarNominatim(e.target, "destSugerencias", (sel) => {
    destSelecc = { lat: sel.lat, lng: sel.lng, txt: sel.txt };
    invalidarBusquedaVehiculos();
    $("inpDestino").value = sel.txt;
    if (markerDestPas) mapPas.removeLayer(markerDestPas);
    markerDestPas = L.marker([sel.lat, sel.lng], { icon: iconDestino }).addTo(mapPas);
    mapPas.setView([sel.lat, sel.lng], 15);
  });
});

// ---------- Solicitar viaje (asignación secuencial, tipos múltiples) ----------
function capacidadDisponible(c) {
  return Number(c.pasajeros) || Number(tiposCache[c.tipoVehiculo]?.capacidad) || 1;
}

function tieneCapacidadSuficiente(c, cantidad) {
  return capacidadDisponible(c) >= cantidad;
}

async function calcularColaConductores(tiposSolicitados, cantidadPasajeros, origenLat, origenLng) {
  tiposSolicitados = tiposSolicitados || [];
  const [condSnap, ubicSnap, viajesSnap] = await Promise.all([
    db.child("conductores").once("value"),
    db.child("ubicaciones").once("value"),
    db.child("viajes").once("value"),
  ]);
  const cond = condSnap.val() || {};
  const ubic = ubicSnap.val() || {};
  const vjs = viajesSnap.val() || {};
  const busy = new Set();
  Object.values(vjs).forEach((v) => {
    if (v.conductorId && (v.estado === "aceptado" || v.estado === "iniciado")) busy.add(v.conductorId);
  });
  const drivers = [];
  Object.values(cond).forEach((c) => {
    if (c.estado === "pendiente") return;
    const dl = c.licenciaExp ? daysUntil(c.licenciaExp) : 0;
    if (!c.licenciaExp || dl <= 0) return;
    if (tiposSolicitados.length && !tiposSolicitados.includes(c.tipoVehiculo)) return; // filtro por categoría elegida
    if (busy.has(c.id)) return;                   // conductor ocupado: no recibe alertas
    if (!tieneCapacidadSuficiente(c, cantidadPasajeros)) return;
    const u = ubic[c.id];
    if (!u || !u.online || typeof u.lat !== "number" || typeof u.lng !== "number") return;
    if (!u.ts || Date.now() - u.ts > 60000) return;
    const d = haversineKm(origenLat, origenLng, u.lat, u.lng);
    if (d > RADIO_CERCA) return;
    drivers.push({ id: c.id, distKm: d });
  });
  drivers.sort((a, b) => a.distKm - b.distKm);
  return drivers.map((d) => d.id);
}

async function opcionesVehiculoCercanas(cantidad, origenLat, origenLng, destinoLat, destinoLng) {
  const [condSnap, ubicSnap, viajesSnap] = await Promise.all([
    db.child("conductores").once("value"),
    db.child("ubicaciones").once("value"),
    db.child("viajes").once("value"),
  ]);
  const conductores = condSnap.val() || {};
  const ubicaciones = ubicSnap.val() || {};
  const busy = new Set();
  Object.values(viajesSnap.val() || {}).forEach((v) => {
    if (v.conductorId && ["aceptado", "iniciado"].includes(v.estado)) busy.add(v.conductorId);
  });
  const distKm = haversineKm(origenLat, origenLng, destinoLat, destinoLng);
  const porTipo = {};
  Object.values(conductores).forEach((c) => {
    if (!c.tipoVehiculo || !tiposCache[c.tipoVehiculo] || c.estado === "pendiente" || busy.has(c.id)) return;
    if (!c.licenciaExp || daysUntil(c.licenciaExp) <= 0 || !tieneCapacidadSuficiente(c, cantidad)) return;
    const u = ubicaciones[c.id];
    if (!u?.online || !u.ts || Date.now() - u.ts > 60000 || typeof u.lat !== "number" || typeof u.lng !== "number") return;
    const recogidaKm = haversineKm(origenLat, origenLng, u.lat, u.lng);
    if (recogidaKm > RADIO_CERCA) return;
    if (!porTipo[c.tipoVehiculo]) porTipo[c.tipoVehiculo] = { key: c.tipoVehiculo, tipo: tiposCache[c.tipoVehiculo], conductores: 0, tarifaKm: Number(c.tarifaKm) || DEFAULT_TARIFA, recogidaKm };
    const item = porTipo[c.tipoVehiculo];
    item.conductores++;
    if (recogidaKm < item.recogidaKm) {
      item.recogidaKm = recogidaKm;
      item.tarifaKm = Number(c.tarifaKm) || DEFAULT_TARIFA;
    }
  });
  return Object.values(porTipo).map((o) => ({ ...o, precio: Math.round(distKm * o.tarifaKm + 800) }));
}

$("btnBuscarConductores").addEventListener("click", async () => {
  const feedback = $("viajeMsg");
  msg(feedback, "");
  const cantidad = parseInt($("inpCantPasajeros").value, 10);
  if (!cantidad || cantidad < 1) { msg(feedback, "Indica cuántas personas viajan.", "err"); return; }
  if (!miPos) { msg(feedback, "Selecciona tu ubicación actual con el GPS o el buscador.", "err"); return; }
  if (!destSelecc) { msg(feedback, "Busca y selecciona un destino.", "err"); return; }
  const btn = $("btnBuscarConductores");
  btn.disabled = true;
  btn.textContent = "Buscando vehículos cercanos…";
  msg(feedback, "Buscando vehículos cercanos…", "ok");
  try {
    const opciones = await opcionesVehiculoCercanas(cantidad, miPos.lat, miPos.lng, destSelecc.lat, destSelecc.lng);
    if (!opciones.length) {
      $("opcTipoWrap").style.display = "none";
      $("btnPedirViaje").style.display = "none";
      msg(feedback, `No hay conductores disponibles dentro de ${RADIO_CERCA} km con capacidad para ${cantidad} pasajero(s). Verifica que el conductor tenga la app abierta, GPS permitido y estado Activo.`, "err");
      return;
    }
    renderOpcTipos(cantidad, opciones);
    $("btnPedirViaje").style.display = "block";
    msg(feedback, "Selecciona un tipo de vehículo disponible.", "ok");
  } catch (e) {
    console.error("No se pudieron buscar conductores disponibles", e);
    msg(feedback, "No se pudo consultar la disponibilidad. Intenta de nuevo.", "err");
  } finally {
    btn.disabled = false;
    btn.textContent = "Buscar tipos de vehículos cercanos";
  }
});

$("btnPedirViaje").addEventListener("click", async () => {
  const feedback = $("viajeMsg");
  msg(feedback, "");
  if (!miPos) { msg(feedback, "Espera a que se detecte tu ubicación GPS o selecciona un origen.", "err"); return; }
  if (!destSelecc) { msg(feedback, "Busca y selecciona un destino.", "err"); return; }
  const cantidadPasajeros = parseInt($("inpCantPasajeros").value, 10);
  if (!cantidadPasajeros || cantidadPasajeros < 1) { msg(feedback, "El primer paso es indicar cuántas personas viajan (obligatorio).", "err"); return; }
  const tiposSolicitados = Array.from(document.querySelectorAll("#opcTipos input:checked")).map((i) => i.value);
  if (!tiposSolicitados.length) { msg(feedback, "Selecciona al menos un tipo de vehículo.", "err"); return; }
  const preciosPorTipo = Object.fromEntries(tiposSolicitados.map((tipo) => [tipo, opcionesTipoCache[tipo]?.precio || 0]));

  const btn = $("btnPedirViaje"); btn.disabled = true; btn.textContent = "Buscando conductores de los tipos elegidos...";
  msg(feedback, "Buscando conductores disponibles…", "ok");
  let pasajeroFoto = "", pasajeroTel = "";
  try {
    const ps = await db.child("pasajeros").child(usuario.id).once("value");
    const pd = ps.val() || {};
    pasajeroFoto = pd.fotoPerfil || "";
    pasajeroTel = pd.telefono || "";
  } catch {}

  let cola;
  try {
    cola = await calcularColaConductores(tiposSolicitados, cantidadPasajeros, miPos.lat, miPos.lng);
  } catch (e) {
    console.error("No se pudo actualizar la búsqueda de conductores", e);
    btn.disabled = false; btn.textContent = "Buscar y solicitar viaje";
    msg(feedback, "No se pudo actualizar la disponibilidad. Intenta de nuevo.", "err");
    return;
  }
  if (!cola.length) {
    btn.disabled = false; btn.textContent = "Buscar y solicitar viaje";
    msg(feedback, `Ya no hay conductores disponibles de los tipos elegidos dentro de ${RADIO_CERCA} km. Vuelve a buscar tipos cercanos.`, "err");
    $("opcTipoWrap").style.display = "none";
    $("btnPedirViaje").style.display = "none";
    return;
  }

  const id = genId().replace("USR-", "VIA-");
  const distKm = haversineKm(miPos.lat, miPos.lng, destSelecc.lat, destSelecc.lng);
  const precio = Math.min(...tiposSolicitados.map((tipo) => preciosPorTipo[tipo] || Math.round(distKm * DEFAULT_TARIFA + 800)));
  const v = {
    id, pasajeroId: usuario.id, pasajeroNombre: usuario.nombre, pasajeroFoto, pasajeroTelefono: pasajeroTel,
    origenLat: miPos.lat, origenLng: miPos.lng, origenTxt: $("origenTxt").textContent,
    referenciaPasajero: $("inpReferencia").value.trim(),
    destLat: destSelecc.lat, destLng: destSelecc.lng, destTxt: destSelecc.txt,
    estado: "solicitado", precio, creado: Date.now(),
    tiposSolicitados, preciosPorTipo, cantidadPasajeros,
    cola, ofertaActual: cola.length ? cola[0] : null, ofertaExpira: cola.length ? Date.now() + TIEMPO_RESPUESTA : null,
    conductorId: null, conductorNombre: null, conductorFoto: "",
    fotoVehiculo: "", marca: "", vehiculoColor: "", placa: "", pin: null, pinVerificado: false,
  };
  try {
    await db.child("viajes").child(id).set(v);
  } catch (e) {
    console.error("No se pudo enviar la solicitud de viaje", e);
    btn.disabled = false; btn.textContent = "Buscar y solicitar viaje";
    msg(feedback, "No se pudo enviar la solicitud. Intenta de nuevo.", "err");
    return;
  }
  misViajeId = id; localStorage.setItem("miViaje", id);
  if (markerDestPas) mapPas.removeLayer(markerDestPas);
  markerDestPas = L.marker([destSelecc.lat, destSelecc.lng], { icon: iconDestino }).addTo(mapPas);
  msg(feedback, "");
  escucharMiViaje(v);
  cambiarVistaPasajero("mapa");
});

$("btnCancelarViaje").addEventListener("click", () => {
  if (!misViajeId) return;
  db.child("viajes").child(misViajeId).once("value", (s) => {
    const vj = s.val();
    if (!vj) return;
    db.child("viajes").child(misViajeId).update({ estado: "cancelado", canceladoEn: Date.now() });
    // Sincronización bidireccional: notificar de inmediato al conductor asignado
    if (vj.conductorId) {
      db.child("notificaciones").child(vj.conductorId).push({
        tipo: "cancelacion", viajeId: misViajeId,
        texto: `${vj.pasajeroNombre || "El pasajero"} canceló el viaje.`, ts: Date.now(),
      });
    }
  });
});

// ---------- Avance secuencial de la cadena de envío ----------
function detenerAvanceOferta() {
  if (ofertaTimer) { clearInterval(ofertaTimer); ofertaTimer = null; }
}
// Reintento encadenado: pasa al siguiente conductor más cercano y re-evalúa la lista
// por si nuevos conductores se acaban de conectar (requerimiento 4).
function avanzarOferta(vj) {
  const yaOfertado = vj.ofertaActual || null;
  db.child("viajes").child(vj.id).child("cola").once("value", async (snap) => {
    const cola = (snap.val() || []).filter((x) => x !== yaOfertado);
    const nuevos = await calcularColaConductores(vj.tiposSolicitados || [vj.tipoVehiculo], vj.cantidadPasajeros || 1, vj.origenLat, vj.origenLng);
    const fusion = [...new Set([...cola, ...nuevos])].filter((x) => x !== yaOfertado);
    if (!fusion.length) {
      await db.child("viajes").child(vj.id).update({ estado: "sin_conductor", ofertaActual: null, ofertaExpira: null, cola: [] });
      return;
    }
    await db.child("viajes").child(vj.id).update({ cola: fusion, ofertaActual: fusion[0], ofertaExpira: Date.now() + TIEMPO_RESPUESTA });
  });
}
function iniciarAvanceOferta(vj) {
  detenerAvanceOferta();
  ofertaTimer = setInterval(() => {
    if (!vj.ofertaActual) return;
    if (Date.now() >= (vj.ofertaExpira || 0)) avanzarOferta(vj);
  }, 500);
}

// ---------- Escuchar mi viaje (pasajero) ----------
function resetBotonBuscar() {
  $("btnPedirViaje").disabled = false;
  $("btnBuscarConductores").style.display = "block";
  $("btnPedirViaje").style.display = "none";
  $("opcTipoWrap").style.display = "none";
}

function conductorCardHTML(vj) {
  if (!vj.conductorNombre && !vj.placa) return "";
  return `<div class="recogida">
    <img src="${vj.conductorFoto || iconoAvatarFallback}" alt="conductor" class="rv-avatar lg" onerror="this.style.visibility='hidden'">
    <div>
      <b>👤 ${escapeHtml(vj.conductorNombre || "Conductor")}</b>
      ${vj.fotoVehiculo ? `<div class="t-mini"><img src="${vj.fotoVehiculo}" alt="vehículo" class="mini-veh" onerror="this.style.display='none'"></div>` : ""}
      ${vj.marca || vj.vehiculoColor ? `<div class="t-mini">🚙 ${escapeHtml([vj.marca, vj.vehiculoColor].filter(Boolean).join(" "))}</div>` : ""}
      ${vj.placa ? `<div class="t-mini">🔤 Placa: <b>${escapeHtml(vj.placa)}</b></div>` : ""}
    </div>
  </div>`;
}

function escucharMiViaje(v) {
  viajeAceptoMostrado = sessionStorage.getItem("aceptoMostrado");
  if (viajeEscuchadoRef && viajeEscuchadoCb) viajeEscuchadoRef.off("value", viajeEscuchadoCb);
  const info = $("viajeInfo");
  info.style.display = "block";
  $("btnPedirViaje").disabled = true;
  $("btnCancelarViaje").style.display = "block";
  $("btnBuscarConductores").style.display = "none";
  $("opcTipoWrap").style.display = "none";
  $("btnPedirViaje").style.display = "none";
  $("viajeConductor").textContent = "";
  $("viajeConductorDetail").innerHTML = "";
  $("viajePin").style.display = "none";
  $("viajeEta").textContent = "";
  $("chatPasajero").style.display = "none";
  $("chatPasVacio").style.display = "flex";
  $("proxAlert").style.display = "none";
  durmiendoProx = false;

  viajeEscuchadoRef = db.child("viajes").child(v.id);
  viajeEscuchadoCb = (snap) => {
    if (!snap.exists()) return;
    const vj = snap.val();
    viajePasajeroActual = vj;
    const estadoViaje = vj.conductorId && vj.estado === "solicitado" ? "aceptado" : vj.estado;
    const est = $("viajeEstado");
    const precio = $("viajePrecio");
    const det = $("viajeConductorDetail");
    const pinBox = $("viajePin");
    if (estadoViaje === "solicitado") {
      detenerAvanceOferta();
      iniciarAvanceOferta(vj);
      est.textContent = "⏳ Buscando conductor...";
      precio.textContent = "Tarifa estimada: ₡" + (vj.precio || 0).toLocaleString() + (vj.cantidadPasajeros ? " · " + vj.cantidadPasajeros + " pasajero(s)" : "");
      pinBox.style.display = "none";
    } else if (estadoViaje === "aceptado") {
      detenerAvanceOferta();
      est.textContent = "🎉 ¡Viaje Aceptado! · 🚗 Conductor en camino";
      est.style.color = "var(--primario-osc)";
      precio.textContent = "Tarifa estimada: ₡" + (vj.precio || 0).toLocaleString();
      if (vj.pin) {
        pinBox.style.display = "block";
        pinBox.innerHTML = `<div class="pin-label">PIN de seguridad · compártelo al abordar</div>
          <div class="pin-num">${escapeHtml(String(vj.pin))}</div>`;
      }
      det.innerHTML = conductorCardHTML(vj);
      $("viajeConductor").textContent = "en camino hacia ti";
      actualizarEta(vj);
      seguirConductor(vj.conductorId);
      $("chatPasajero").style.display = "block";
      $("chatPasVacio").style.display = "none";
      escucharChat(v.id, $("chatMsgsPas"), "pasajero");
      // Alerta emergente automática de aceptación (solo una vez)
      if (vj.pin && viajeAceptoMostrado !== v.id) {
        viajeAceptoMostrado = v.id;
        sessionStorage.setItem("aceptoMostrado", v.id);
        $("acepPinNum").textContent = vj.pin || "---";
        $("acepDetalle").innerHTML = conductorCardHTML(vj);
        $("acepEta").textContent = $("viajeEta").textContent.replace("Llegada aproximada: ", "") || "calculando…";
        $("aceptoModal").style.display = "flex";
        beepAlert();
      }
    } else if (estadoViaje === "iniciado") {
      detenerAvanceOferta();
      est.textContent = "🟢 Viaje en curso";
      precio.textContent = "Tarifa: ₡" + (vj.precio || 0).toLocaleString();
      $("viajeEta").textContent = "";
      if (vj.pin) {
        pinBox.style.display = "block";
        pinBox.innerHTML = `<div class="pin-label">PIN de seguridad</div><div class="pin-num">${escapeHtml(String(vj.pin))}</div>`;
      }
      det.innerHTML = conductorCardHTML(vj);
      $("viajeConductor").textContent = "En camino a tu destino";
      seguirConductor(vj.conductorId);
      $("chatPasajero").style.display = "block";
      $("chatPasVacio").style.display = "none";
      escucharChat(v.id, $("chatMsgsPas"), "pasajero");
    } else if (estadoViaje === "finalizado") {
      detenerAvanceOferta();
      est.textContent = "🏁 Viaje finalizado";
      precio.textContent = "Total a pagar en efectivo: ₡" + (vj.precio || 0).toLocaleString();
      $("viajeConductorDetail").innerHTML = "";
      $("viajeConductor").textContent = "¡Gracias por viajar con Viaje Rural!";
      $("btnCancelarViaje").style.display = "none";
      resetBotonBuscar();
      sessionStorage.removeItem("aceptoMostrado");
      viajeAceptoMostrado = null;
      $("chatPasajero").style.display = "none";
      $("chatPasVacio").style.display = "flex";
      $("proxAlert").style.display = "none";
      $("viajePin").style.display = "none";
      detenerChat(); detenerSeguimientoConductor();
      localStorage.removeItem("miViaje"); misViajeId = null;
    } else if (estadoViaje === "cancelado") {
      detenerAvanceOferta();
      est.textContent = "✖ Viaje cancelado";
      precio.textContent = "";
      $("btnCancelarViaje").style.display = "none";
      resetBotonBuscar();
      sessionStorage.removeItem("aceptoMostrado");
      viajeAceptoMostrado = null;
      $("chatPasajero").style.display = "none";
      $("chatPasVacio").style.display = "flex";
      $("proxAlert").style.display = "none";
      $("viajePin").style.display = "none";
      detenerChat(); detenerSeguimientoConductor();
      localStorage.removeItem("miViaje"); misViajeId = null;
    } else if (estadoViaje === "sin_conductor") {
      detenerAvanceOferta();
      est.textContent = "⚠️ No hay conductores disponibles ahora";
      precio.textContent = "Intenta de nuevo más tarde.";
      $("btnCancelarViaje").style.display = "block";
      resetBotonBuscar();
      sessionStorage.removeItem("aceptoMostrado");
      viajeAceptoMostrado = null;
      $("btnCancelarViaje").style.display = "none";
      localStorage.removeItem("miViaje"); misViajeId = null;
    }
  };
  viajeEscuchadoRef.on("value", viajeEscuchadoCb);
}

function actualizarEta(vj) {
  const ubicacion = ubicacionesCache?.[vj.conductorId];
  if (!ubicacion || typeof ubicacion.lat !== "number") {
    $("viajeEta").textContent = "Llegada aproximada: calculando…";
    return;
  }
  const km = haversineKm(ubicacion.lat, ubicacion.lng, vj.origenLat, vj.origenLng);
  const mins = Math.max(1, Math.ceil(km / 25 * 60));
  $("viajeEta").textContent = `Llegada aproximada: ${mins} min · ${km.toFixed(1)} km`;
  $("acepEta").textContent = `${mins} min`;
}
function actualizarEtaDesdeUbicacion(u) {
  const vj = viajePasajeroActual;
  if (vj?.estado !== "aceptado" || !u || typeof u.lat !== "number") return;
  const km = haversineKm(u.lat, u.lng, vj.origenLat, vj.origenLng);
  const mins = Math.max(1, Math.ceil(km / 25 * 60));
  $("viajeEta").textContent = `Llegada aproximada: ${mins} min · ${km.toFixed(1)} km`;
  $("acepEta").textContent = `${mins} min`;
}

// ---------- Seguimiento en vivo del conductor ----------
let segRef = null, segCb = null, markerConductorSeg = null;
let ultimaAlertaProx = 0;
function seguirConductor(conductorId) {
  detenerSeguimientoConductor();
  if (!conductorId) return;
  durmiendoProx = false;
  markerConductorSeg = L.marker([0, 0], { icon: iconConductor }).addTo(mapPas);
  segRef = db.child("ubicaciones").child(conductorId);
  segCb = segRef.on("value", (snap) => {
    const u = snap.val();
    if (!u || typeof u.lat !== "number") return;
    markerConductorSeg.setLatLng([u.lat, u.lng]);
    if (mapPas && document.querySelector('[data-pass-view="mapa"]').classList.contains("active")) mapPas.setView([u.lat, u.lng], 16);
    actualizarEtaDesdeUbicacion(u);
    // Alerta de proximidad (visual + sonora) cuando el conductor está cerca
    if (miPos && Date.now() - ultimaAlertaProx > 60000) {
      const d = haversineKm(miPos.lat, miPos.lng, u.lat, u.lng);
      if (d <= DIST_PROXIMIDAD) {
        ultimaAlertaProx = Date.now();
        durmiendoProx = true;
        const px = $("proxAlert");
        px.style.display = "block";
        beepAlert();
        setTimeout(() => { px.style.display = "none"; }, 9000);
      }
    }
  });
}
function detenerSeguimientoConductor() {
  if (segRef && segCb) { segRef.off("value", segCb); segRef = null; segCb = null; }
  if (markerConductorSeg && mapPas) { mapPas.removeLayer(markerConductorSeg); markerConductorSeg = null; }
}

// ---------- Conductores disponibles cerca ----------
let ubicacionesRef = null, ubicacionesCb = null, ubicacionesCache = null, ubicacionesRefreshTimer = null;
let cargandoCondLista = false;
function iniciarConductoresCerca() {
  if (ubicacionesRef && ubicacionesCb) return;
  ubicacionesRef = db.child("ubicaciones");
  ubicacionesCb = ubicacionesRef.on("value", (snap) => {
    ubicacionesCache = snap.val() || {};
    renderConductoresCerca();
  });
  ubicacionesRefreshTimer = setInterval(renderConductoresCerca, 15000);
}
function detenerConductoresCerca() {
  if (ubicacionesRef && ubicacionesCb) { ubicacionesRef.off("value", ubicacionesCb); ubicacionesRef = null; ubicacionesCb = null; }
  if (ubicacionesRefreshTimer) { clearInterval(ubicacionesRefreshTimer); ubicacionesRefreshTimer = null; }
  ubicacionesCache = null;
}
function renderConductoresCerca() {
  const panel = $("condDisponibles");
  const lista = $("listaConductoresCerca");
  if (!panel || !lista) return;
  if (!miPos || !ubicacionesCache) { panel.style.display = "none"; return; }
  const condInfo = listaCondCache || {};
  if (Object.keys(condInfo).length === 0) {
    panel.style.display = "none";
    if (!cargandoCondLista) {
      cargandoCondLista = true;
      db.child("conductores").once("value", (snap) => {
        listaCondCache = snap.val() || {};
        cargandoCondLista = false;
        if (Object.keys(listaCondCache).length) renderConductoresCerca();
      });
    }
    return;
  }
  const drivers = Object.entries(ubicacionesCache)
    .filter(([id, u]) => u.online && u.ts && Date.now() - u.ts <= 60000 && typeof u.lat === "number" && typeof u.lng === "number")
    .filter(([id]) => {
      const c = condInfo[id];
      return c && c.estado !== "pendiente" && c.licenciaExp && daysUntil(c.licenciaExp) > 0;
    })
    .map(([id, u]) => ({
      id,
      nombre: condInfo[id]?.nombre || "Conductor",
      tipo: condInfo[id]?.tipoVehiculo,
      distKm: haversineKm(miPos.lat, miPos.lng, u.lat, u.lng),
      ts: u.ts,
    }))
    .filter((d) => d.distKm <= RADIO_CERCA)
    .sort((a, b) => a.distKm - b.distKm);
  if (!drivers.length) { panel.style.display = "none"; return; }
  panel.style.display = "block";
  lista.innerHTML = "";
  drivers.forEach((d) => {
    const div = document.createElement("div");
    div.className = "trip-card";
    div.innerHTML = `<b>${escapeHtml(d.nombre)}</b>` +
      `${d.tipo ? `<div class="t-mini">🚗 ${escapeHtml(tiposCache[d.tipo]?.nombre || d.tipo)}</div>` : ""}` +
      `<div class="t-mini">📍 A <b>${d.distKm.toFixed(2)} km</b> de tu ubicación</div>` +
      `<div class="t-mini">🕒 Actualizado ${d.ts ? new Date(d.ts).toLocaleTimeString("es-CR") : "—"}</div>`;
    lista.appendChild(div);
  });
}

// ============================================================
//                 CHAT
// ============================================================
let chatListenRef = null, chatListenCb = null, chatListenKey = null;
function escucharChat(viajeId, elLista, miRol) {
  const listenKey = `${viajeId}:${miRol}`;
  if (chatListenRef && chatListenKey === listenKey) return;
  detenerChat();
  if (!viajeId) return;
  chatListenKey = listenKey;
  chatListenRef = db.child("mensajes").child(viajeId).orderByChild("ts");
  chatListenCb = chatListenRef.on("value", (snap) => {
    elLista.innerHTML = "";
    let any = false;
    snap.forEach((ch) => {
      any = true;
      const m = ch.val();
      const div = document.createElement("div");
      div.className = "chat-msg" + (m.rol === miRol ? " mine" : "");
      div.innerHTML = `<div class="cb">${escapeHtml(m.texto)}</div><div class="cm">${escapeHtml(m.autor)} · ${m.ts ? new Date(m.ts).toLocaleTimeString("es-CR") : ""}</div>`;
      elLista.appendChild(div);
    });
    if (!any) elLista.innerHTML = '<div class="chat-empty">Sin mensajes aún</div>';
    elLista.scrollTop = elLista.scrollHeight;
  }, (error) => {
    console.error("No se pudo escuchar el chat del viaje", error);
    elLista.innerHTML = '<div class="chat-empty">No se pudo cargar el chat. Revisa tu conexión e inténtalo otra vez.</div>';
  });
}
function detenerChat() {
  if (chatListenRef && chatListenCb) chatListenRef.off("value", chatListenCb);
  chatListenRef = null; chatListenCb = null; chatListenKey = null;
}
async function enviarChat(viajeId, inpEl) {
  if (!viajeId) return;
  const texto = inpEl.value.trim();
  if (!texto) return;
  const btn = inpEl.parentElement.querySelector("button");
  if (btn) btn.disabled = true;
  try {
    await db.child("mensajes").child(viajeId).push({
      texto, autor: usuario?.nombre || "Usuario", autorId: usuario?.id || "",
      rol: usuario?.rol || "", ts: firebase.database.ServerValue.TIMESTAMP,
    });
    inpEl.value = "";
  } catch (e) {
    console.error("No se pudo enviar el mensaje del viaje", e);
    alert("No se pudo enviar el mensaje. Revisa tu conexión e inténtalo otra vez.");
  } finally {
    if (btn) btn.disabled = false;
  }
}
function chatEnter(inp, viajeIdFn) {
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); enviarChat(viajeIdFn(), inp); } });
}
$("btnSendPas").addEventListener("click", () => enviarChat(misViajeId, $("chatInpPas")));
chatEnter($("chatInpPas"), () => misViajeId);
$("btnSendCond").addEventListener("click", () => enviarChat(viajeActivoId, $("chatInpCond")));
chatEnter($("chatInpCond"), () => viajeActivoId);

// ============================================================
//              VISTA CONDUCTOR — GPS + OFERTAS
// ============================================================
let gpsOn = true, watchId = null, lastPos = null, gpsTimer = null;
let condDatos = null;
let viajesRootRef = null, viajesCb = null, dbActivoCache = null;
let viajeActivoId = null;
let ofertaAlertaId = null, alertaTiempoTimer = null;
let ofertaExpiraActiva = null, viajeCondActivoPrevio = null, viajeCondEstadoPrevio = null;
let condCancelTimer = null;
let pinVisibleCond = false, condCancelMostradoId = null;
let mapCond = null, markerCond = null, markerPickCond = null;
let pinIngresado = "";
let notifRootRef = null, notifCb = null;
const otpInputs = Array.from(document.querySelectorAll("[data-otp]"));
function actualizarOtpConductor() {
  const pinInput = $("inpPinConductor");
  pinInput.value = otpInputs.map((input) => input.value).join("");
  pinInput.dispatchEvent(new Event("input", { bubbles: true }));
}
otpInputs.forEach((input, index) => {
  input.addEventListener("input", () => {
    input.value = input.value.replace(/\D/g, "").slice(-1);
    if (input.value && index < otpInputs.length - 1) otpInputs[index + 1].focus();
    actualizarOtpConductor();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Backspace" && !input.value && index > 0) otpInputs[index - 1].focus();
  });
  input.addEventListener("paste", (event) => {
    event.preventDefault();
    const digits = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, 3);
    otpInputs.forEach((box, i) => (box.value = digits[i] || ""));
    otpInputs[Math.min(digits.length, otpInputs.length - 1)].focus();
    actualizarOtpConductor();
  });
});

function iniciarVistaConductor(c) {
  condDatos = { ...c };
  $("view-conductor").style.display = "block";
  $("view-login").style.display = "none";
  $("conductorNombre").textContent = c.nombre;
  $("mapConductor").style.display = "none";
  $("btnToggleMapaCond").textContent = "🗺️ Ver mapa";
  cambiarVistaConductor("inicio");
  $("condId").textContent = "ID: " + c.id;
  const dl = daysUntil(c.licenciaExp);
  const mini = $("licCondDias");
  mini.textContent = dl + " día" + (dl === 1 ? "" : "s") + " de licencia";
  mini.classList.toggle("bad", dl <= 7);

  iniciarGPS();
  inicializarMapaConductor();
  iniciarViajesConductor();
}

function cambiarVistaConductor(tab) {
  document.querySelectorAll("[data-cond-view]").forEach((s) => s.classList.toggle("active", s.dataset.condView === tab));
  document.querySelectorAll("[data-cond-tab]").forEach((b) => b.classList.toggle("active", b.dataset.condTab === tab));
  if (tab === "mapa" && mapCond) setTimeout(() => mapCond.invalidateSize(), 100);
}
document.querySelectorAll("[data-cond-tab]").forEach((b) => b.addEventListener("click", () => cambiarVistaConductor(b.dataset.condTab)));
$("btnPerfilCondNav").addEventListener("click", () => $("btnAjustesCond").click());

let condActivo = true;
let gpsHandlersIniciados = false;
function conductorPuedeRecibirViajes() {
  return condActivo && !document.hidden && !!lastPos;
}
function actualizarDisponibilidadConductor() {
  if (usuario?.rol === "conductor") {
    db.child("ubicaciones").child(usuario.id).update({ online: conductorPuedeRecibirViajes() });
  }
}

function iniciarGPS() {
  if (watchId !== null) return;
  if (!navigator.geolocation) {
    $("onlineTxt").textContent = "GPS no disponible";
    actualizarDisponibilidadConductor();
    return;
  }
  $("onlineTxt").textContent = "Solicitando ubicación GPS…";
  const ubicacionRef = db.child("ubicaciones").child(usuario.id);
  ubicacionRef.onDisconnect().update({ online: false }).catch((error) => {
    console.warn("No se pudo registrar el estado offline al desconectar", error);
  });
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      lastPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      $("onlineTxt").textContent = condActivo ? "Compartiendo ubicación" : "Inactivo (sin alertas)";
      if (mapCond) {
        if (markerCond) markerCond.setLatLng([lastPos.lat, lastPos.lng]);
        else markerCond = L.marker([lastPos.lat, lastPos.lng], { icon: iconConductor }).addTo(mapCond);
      }
      enviarPosicion();
    },
    (error) => {
      $("onlineTxt").textContent = error.code === 1 ? "Permite el acceso a tu ubicación GPS" : "Sin señal GPS";
      actualizarDisponibilidadConductor();
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
  );
  if (!gpsTimer) gpsTimer = setInterval(enviarPosicion, 15000);
  if (!gpsHandlersIniciados) {
    gpsHandlersIniciados = true;
    window.addEventListener("beforeunload", () => {
      if (usuario?.rol === "conductor") db.child("ubicaciones").child(usuario.id).update({ online: false });
    });
    document.addEventListener("visibilitychange", () => {
      if (usuario?.rol !== "conductor") return;
      if (!document.hidden && lastPos) enviarPosicion();
      else actualizarDisponibilidadConductor();
    });
  }
}

function enviarPosicion() {
  if (!usuario || usuario.rol !== "conductor" || !gpsOn || !lastPos) return;
  db.child("ubicaciones").child(usuario.id).update({
    lat: lastPos.lat, lng: lastPos.lng,
    ts: firebase.database.ServerValue.TIMESTAMP,
    online: conductorPuedeRecibirViajes(),
  }).catch((error) => console.error("No se pudo actualizar la ubicación del conductor", error));
  if (markerCond && mapCond) markerCond.setLatLng([lastPos.lat, lastPos.lng]);
}

// ---------- Activo / Inactivo ----------
$("btnActivo").addEventListener("click", () => {
  condActivo = !condActivo;
  const b = $("btnActivo");
  b.classList.toggle("on", condActivo);
  b.setAttribute("aria-pressed", String(condActivo));
  $("onlineTxt").textContent = !condActivo ? "Inactivo (sin alertas)" : lastPos ? "Compartiendo ubicación" : "Esperando señal GPS";
  iniciarViajesConductor();
  actualizarDisponibilidadConductor();
  if (condActivo && lastPos) enviarPosicion();
});

// ---------- Escuchar viajes / ofertas ----------
function iniciarViajesConductor() {
  if (viajesRootRef && viajesCb) viajesRootRef.off("value", viajesCb);
  viajesRootRef = db.child("viajes");
  viajesCb = viajesRootRef.on("value", (snap) => {
    dbActivoCache = snap.val() || {};
    renderViajesConductor(dbActivoCache);
  });
}
function detenerViajesConductor() {
  if (viajesRootRef && viajesCb) { viajesRootRef.off("value", viajesCb); viajesRootRef = null; viajesCb = null; }
  detenerAlertaTiempo();
  detenerChat();
}

function miViajeActivo(vjs) {
  for (const id in vjs) {
    const v = vjs[id];
    if (v.conductorId === usuario.id && (v.estado === "aceptado" || v.estado === "iniciado")) return v;
  }
  return null;
}

// ---------- Contador regresivo de la oferta ----------
function detenerAlertaTiempo() {
  if (alertaTiempoTimer) { clearInterval(alertaTiempoTimer); alertaTiempoTimer = null; }
}
function iniciarAlertaTiempo(vj) {
  detenerAlertaTiempo();
  const el = $("alertaTiempo");
  let ultimo = -1;
  const upd = () => {
    const rest = Math.max(0, Math.ceil((vj.ofertaExpira - Date.now()) / 1000));
    el.innerHTML = "⏱ Tienes <b>" + rest + "</b> segundos para responder";
    if (rest !== ultimo) {
      if (rest <= 3 && rest > 0) beepAlert();
      ultimo = rest;
    }
    if (rest <= 0) detenerAlertaTiempo();
  };
  upd();
  alertaTiempoTimer = setInterval(upd, 500);
}

function renderViajesConductor(vjs) {
  const activo = miViajeActivo(vjs);

  if (activo && viajeCondActivoPrevio !== activo.id) {
    pinIngresado = "";
    $("inpPinConductor").value = "";
    document.querySelectorAll("[data-otp]").forEach((input) => (input.value = ""));
    pinVisibleCond = false;
  }

  if (activo) {
    clearTimeout(condCancelTimer);
    $("condCancelNotice").style.display = "none";
    viajeActivoId = activo.id;
    detenerAlertaTiempo();
    $("alertaViaje").style.display = "none";
    $("panelEspera").style.display = "none";
    $("panelActivo").style.display = "block";
    $("finArribaWrap").style.display = activo.estado === "iniciado" ? "block" : "none";

    const pinBox = $("pinValidBox");
    const pinInp = $("inpPinConductor");
    const btnPin = $("btnConfirmarPin");
    if (activo.estado === "aceptado") {
      const pinVerificado = !!activo.pinVerificado;
      if (viajeCondActivoPrevio !== activo.id || viajeCondEstadoPrevio !== activo.estado) {
        pinVisibleCond = false;
        pinInp.value = "";
        pinIngresado = "";
        btnPin.disabled = true;
        btnPin.style.display = "none";
        btnPin.textContent = "🧭 Iniciar viaje hacia el destino";
        $("pinValidMsg").textContent = "";
        pinInp.oninput = () => {
          const entered = pinInp.value.replace(/\D/g, "").slice(0, 3);
          pinInp.value = entered;
          pinIngresado = entered.length === 3 && entered === String(activo.pin) ? entered : "";
          btnPin.disabled = !pinIngresado;
          $("pinValidMsg").className = pinIngresado ? "feedback ok" : entered.length === 3 ? "feedback err" : "feedback";
          btnPin.style.display = pinIngresado ? "block" : "none";
          $("pinValidMsg").textContent = pinIngresado
            ? "✅ PIN correcto. Presiona para iniciar el viaje y abrir Waze."
            : entered.length === 3 ? "❌ PIN incorrecto." : "";
        };
      }
      $("btnAbrirPin").style.display = pinVerificado || pinVisibleCond ? "none" : "block";
      pinBox.style.display = !pinVerificado && pinVisibleCond ? "block" : "none";
      if (!pinIngresado || pinVerificado || !pinVisibleCond) btnPin.style.display = "none";
    } else {
      pinBox.style.display = "none";
      $("btnAbrirPin").style.display = "none";
      btnPin.style.display = "none";
    }
    viajeCondActivoPrevio = activo.id;
    viajeCondEstadoPrevio = activo.estado;

    // Reconocimiento del pasajero
    $("tripFotoPas").src = activo.pasajeroFoto || iconoAvatarFallback;
    $("tripPasNombre").textContent = activo.pasajeroNombre || "Pasajero";
    $("tripPasTel").textContent = activo.pasajeroTelefono ? "📱 " + activo.pasajeroTelefono : "";

    $("tripDetalle").innerHTML =
      (activo.cantidadPasajeros ? `<div class="t-mini">🧑‍🤝‍🧑 Pasajeros: ${activo.cantidadPasajeros}</div>` : "") +
      `<div class="t-mini">📍 Origen: <small>${escapeHtml(activo.origenTxt)}</small></div>` +
      (activo.referenciaPasajero ? `<div class="t-mini">📝 Referencia: <small>${escapeHtml(activo.referenciaPasajero)}</small></div>` : "") +
      `<div class="t-mini">🏁 Destino: <small>${escapeHtml(activo.destTxt)}</small></div>` +
      `<div class="t-mini">💰 Tarifa: ₡${(activo.precio || 0).toLocaleString()}</div>` +
      `<b>${activo.estado === "iniciado" ? "Viaje en curso" : activo.pinVerificado ? "Pasajero a bordo" : "Camino hacia el pasajero"}</b>`;

    $("chatConductor").style.display = "block";
    $("chatCondVacio").style.display = "none";
    if (chatListenKey !== `${activo.id}:conductor`) escucharChat(activo.id, $("chatMsgsCond"), "conductor");

    // Mapa del conductor: mostrar punto de recogida y posición
    mostrarMapaConductor(activo);
    return;
  }

  // Sin viaje activo
  viajeActivoId = null;
  detenerChat();
  $("chatConductor").style.display = "none";
  $("chatCondVacio").style.display = "flex";
  $("panelActivo").style.display = "none";
  $("finArribaWrap").style.display = "none";

  const cancelado = Object.values(vjs).filter((v) =>
    v.estado === "cancelado" &&
    (v.conductorId === usuario.id || (Array.isArray(v.cola) && v.cola.includes(usuario.id))) &&
    v.canceladoEn && Date.now() - v.canceladoEn < 120000
  )
    .sort((a, b) => (b.actualizado || b.creado || 0) - (a.actualizado || a.creado || 0))[0];
  if (cancelado && cancelado.id !== condCancelMostradoId && !condCancelTimer) {
    condCancelMostradoId = cancelado.id;
    cambiarVistaConductor("inicio");
    $("condCancelNotice").style.display = "block";
    $("condCancelNotice").textContent = `${cancelado.pasajeroNombre || "El pasajero"} canceló el viaje.`;
    condCancelTimer = setTimeout(() => {
      $("condCancelNotice").style.display = "none";
      condCancelTimer = null;
    }, 10000);
  }
  // Buscar si le toca responder una oferta en la cadena
  const miOferta = condActivo ? Object.values(vjs).find((v) =>
    v.estado === "solicitado" && v.ofertaActual === usuario.id && Number(v.ofertaExpira) > Date.now()
  ) : null;
  if (miOferta) {
    const ofertaNueva = ofertaAlertaId !== miOferta.id || ofertaExpiraActiva !== miOferta.ofertaExpira;
    if (ofertaNueva) cambiarVistaConductor("inicio");
    ofertaAlertaId = miOferta.id;
    ofertaExpiraActiva = miOferta.ofertaExpira;
    const dist = lastPos && typeof miOferta.origenLat === "number"
      ? haversineKm(lastPos.lat, lastPos.lng, miOferta.origenLat, miOferta.origenLng) : null;
    $("alertaFotoPas").src = miOferta.pasajeroFoto || iconoAvatarFallback;
    $("alertaPasNombre").textContent = miOferta.pasajeroNombre || "Pasajero";
    $("alertaCantPas").textContent = "🧑‍🤝‍🧑 " + (miOferta.cantidadPasajeros || 1) + " pasajero(s)";
    $("alertaOrigen").textContent = "📍 Origen: " + (miOferta.origenTxt || "—");
    $("alertaReferencia").textContent = miOferta.referenciaPasajero ? "📝 Referencia: " + miOferta.referenciaPasajero : "";
    $("alertaDestino").textContent = "🏁 Destino: " + (miOferta.destTxt || "—");
    const tarifaOferta = miOferta.preciosPorTipo?.[condDatos?.tipoVehiculo] || miOferta.precio || 0;
    $("alertaDist").textContent =
      (dist != null ? "📏 Pasajero a " + dist.toFixed(2) + " km de ti · " : "") +
      "💰 ₡" + tarifaOferta.toLocaleString();
    $("alertaViaje").style.display = "block";
    $("panelEspera").style.display = "none";
    if (ofertaNueva) beepAlert();
    $("btnAceptarAlerta").onclick = () => aceptarViaje(miOferta.id);
    $("btnRechazarAlerta").onclick = () => {
      // Pasar la oferta al siguiente de la cadena
      db.child("viajes").child(miOferta.id).update({ ofertaExpira: 0 });
      $("alertaViaje").style.display = "none";
    };
    if (ofertaNueva) iniciarAlertaTiempo(miOferta);
  } else {
    ofertaAlertaId = null;
    ofertaExpiraActiva = null;
    detenerAlertaTiempo();
    $("alertaViaje").style.display = "none";
    $("panelEspera").style.display = condActivo ? "block" : "none";
  }
}

// ---------- Mapa del conductor (ocultable) ----------
function mostrarMapaConductor(activo) {
  inicializarMapaConductor([activo.origenLat, activo.origenLng]);
  mapCond.setView([activo.origenLat, activo.origenLng], 15);
  if (markerPickCond) mapCond.removeLayer(markerPickCond);
  markerPickCond = L.marker([activo.origenLat, activo.origenLng], { icon: iconDestino }).addTo(mapCond).bindPopup("Punto de recogida");
  if (markerCond) mapCond.removeLayer(markerCond);
  markerCond = L.marker([lastPos?.lat || activo.origenLat, lastPos?.lng || activo.origenLng], { icon: iconConductor }).addTo(mapCond);
  setTimeout(() => mapCond.invalidateSize(), 150);
}
function inicializarMapaConductor(center = [lastPos?.lat || 9.9281, lastPos?.lng || -84.0907]) {
  if (mapCond) return;
  mapCond = L.map("mapConductor").setView(center, 14);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap" }).addTo(mapCond);
  if (lastPos) markerCond = L.marker([lastPos.lat, lastPos.lng], { icon: iconConductor }).addTo(mapCond);
}
$("btnToggleMapaCond").addEventListener("click", () => {
  const el = $("mapConductor");
  const vis = el.style.display === "none";
  el.style.display = vis ? "block" : "none";
  $("btnToggleMapaCond").textContent = vis ? "🗺️ Ocultar mapa" : "🗺️ Ver mapa";
  if (vis && mapCond) setTimeout(() => mapCond.invalidateSize(), 100);
});
$("btnAbrirPin").addEventListener("click", () => {
  const activo = Object.values(dbActivoCache || {}).find((x) => x.conductorId === usuario?.id && x.estado === "aceptado");
  if (!activo) return;
  pinVisibleCond = true;
  $("btnAbrirPin").style.display = "none";
  $("pinValidBox").style.display = "block";
  window.open(`https://waze.com/ul?ll=${activo.origenLat},${activo.origenLng}&navigate=yes`, "_blank");
  document.querySelector('[data-otp="0"]').focus();
});

// ---------- Aceptar oferta (transacción anti-duplicado + generación de PIN) ----------
function aceptarViaje(viajeId) {
  db.child("viajes").child(viajeId).transaction((v) => {
    if (v && v.estado === "solicitado" && v.ofertaActual === usuario.id && Number(v.ofertaExpira) > Date.now()) {
      v.estado = "aceptado";
      v.conductorId = usuario.id;
      v.conductorNombre = usuario.nombre;
      v.conductorFoto = condDatos?.fotoPerfil || "";
      v.fotoVehiculo = condDatos?.fotoVehiculo || "";
      v.marca = condDatos?.marca || "";
      v.vehiculoColor = condDatos?.colorVehiculo || "";
      v.placa = condDatos?.placa || "";
      v.tipoVehiculoAsignado = condDatos?.tipoVehiculo || "";
      v.precio = v.preciosPorTipo?.[v.tipoVehiculoAsignado] || v.precio;
      v.pin = genPin();
      v.aceptadoEn = Date.now();
      v.ofertaActual = null;
      v.ofertaExpira = null;
      v.cola = [];
    }
    return v;
  }, (err, committed) => {
    if (committed) {
      detenerAlertaTiempo();
      $("alertaViaje").style.display = "none";
      cambiarVistaConductor("inicio");
    } else {
      if (err) console.error("No se pudo aceptar la solicitud", err);
      alert("La solicitud venció, ya fue tomada o dejó de estar disponible.");
    }
  });
}

// ---------- Validar PIN e iniciar el viaje hacia el destino ----------
$("btnConfirmarPin").addEventListener("click", () => {
  const activo = Object.values(dbActivoCache || {}).find((x) => x.conductorId === usuario?.id && x.estado === "aceptado");
  const btn = $("btnConfirmarPin");
  const pin = pinIngresado;
  if (!activo || pin !== String(activo.pin)) {
    alert("Ingresa el PIN correcto de 3 dígitos que te indique el pasajero.");
    return;
  }
  btn.disabled = true;
  btn.textContent = "Abriendo destino en Waze…";
  const waze = window.open("about:blank", "_blank");
  db.child("viajes").child(activo.id).transaction((v) => {
    if (v && v.estado === "aceptado" && v.conductorId === usuario.id && String(v.pin) === pin) {
      v.pinVerificado = true;
      v.pinVerificadoEn = Date.now();
      v.estado = "iniciado";
      v.iniciadoEn = Date.now();
    }
    return v;
  }, (err, committed, snapshot) => {
    const viaje = snapshot?.val();
    if (committed && viaje?.estado === "iniciado" && viaje.conductorId === usuario.id && viaje.pinVerificado) {
      if (waze) waze.location.href = `https://waze.com/ul?ll=${activo.destLat},${activo.destLng}&navigate=yes`;
      cambiarVistaConductor("inicio");
      return;
    }
    if (waze) waze.close();
    btn.disabled = false;
    btn.textContent = "🧭 Iniciar viaje hacia el destino";
    if (err) console.error("No se pudo validar el PIN o iniciar el viaje", err);
    alert("No se pudo iniciar el viaje. Verifica el PIN e inténtalo de nuevo.");
  });
});

// ---------- Finalizar viaje: notifica al pasajero, cierra y libera ----------
$("btnFinalizarViaje").addEventListener("click", () => {
  const activo = Object.values(dbActivoCache || {}).find((x) => x.conductorId === usuario?.id);
  if (!activo) return;
  if (!confirm("¿Finalizar el viaje? El pasajero será notificado en el momento.")) return;
  db.child("viajes").child(activo.id).update({ estado: "finalizado", finEn: Date.now() });
  if (activo.pasajeroId) {
    db.child("notificaciones").child(activo.pasajeroId).push({
      tipo: "finalizado", viajeId: activo.id,
      texto: `Tu conductor finalizó el viaje. Total a pagar en efectivo: ₡${(activo.precio || 0).toLocaleString()}. ¡Gracias!`, ts: Date.now(),
    });
  }
  // Liberar al conductor: vuelve a estar disponible para nuevas alertas
  actualizarDisponibilidadConductor();
  $("panelActivo").style.display = "none";
  $("finArribaWrap").style.display = "none";
});

function abrirFinanzas() {
  const cont = $("listaHistorialCond");
  const modal = $("historialModal");
  $("historialModalTitle").textContent = "💵 Finanzas de viaje";
  modal.style.display = "flex";
  cont.innerHTML = '<div class="trip-card"><span>Cargando...</span></div>';
  db.child("viajes").orderByChild("conductorId").equalTo(usuario.id).once("value", (snap) => {
    const v = snap.val() || {};
    const realizados = Object.values(v).filter((t) => t.estado === "finalizado");
    const total = realizados.reduce((s, t) => s + (t.precio || 0), 0);
    const html =
      `<div class="trip-card" style="background:#effdf6;border-color:var(--primario)">
         <b>Total ganado: ₡${total.toLocaleString()}</b>
         <div class="t-mini">Viajes completados: ${realizados.length}</div>
         <div class="t-mini">Precio promedio: ₡${realizados.length ? Math.round(total / realizados.length).toLocaleString() : 0}</div>
       </div>`;
    cont.innerHTML = html;
    realizados.sort((a, b) => (b.finEn || b.creado || 0) - (a.finEn || a.creado || 0)).slice(0, 50).forEach((t) => {
      const div = document.createElement("div");
      div.className = "trip-card";
      div.innerHTML =
        `<b>👤 ${escapeHtml(t.pasajeroNombre || "—")} · ₡${(t.precio || 0).toLocaleString()}</b>` +
        `<div class="t-mini">🏁 <small>${escapeHtml(t.destTxt || "")}</small></div>` +
        `<div class="t-mini">🕒 ${t.finEn ? new Date(t.finEn).toLocaleString("es-CR") : "—"}</div>`;
      cont.appendChild(div);
    });
    if (!realizados.length) cont.innerHTML = '<div class="trip-card"><span>Aún no tienes viajes finalizados.</span></div>';
  });
}
// Finanzas ahora solo desde Configuración (requerimiento 9)
$("btnFinanzasAjustes").addEventListener("click", abrirFinanzas);

$("btnSalirConductor").addEventListener("click", salirTodo);

// ============================================================
//                   VISTA ADMIN
// ============================================================
function iniciarVistaAdmin() {
  $("view-admin").style.display = "block";
  $("view-login").style.display = "none";
  cargarListaConductores();
  cargarListaPendientes();
  cargarListaPasajeros();
  cargarViajesAdmin();
  cargarListaTipos();
  cargarDuplicados();
}

document.querySelectorAll(".admin-tab").forEach((t) => {
  t.addEventListener("click", () => {
    document.querySelectorAll(".admin-tab").forEach((x) => x.classList.remove("active"));
    t.classList.add("active");
    document.querySelectorAll(".admin-panel").forEach((x) => (x.style.display = "none"));
    $("atab-" + t.dataset.atab).style.display = "block";
  });
});
$("btnSalirAdmin").addEventListener("click", salirTodo);

// ---------- Crear conductor ----------
function leerAdmCond() {
  return {
    nombre: $("admCondNombre").value.trim(),
    cedula: $("admCondCedula").value.trim(),
    tel: $("admCondTel").value.trim(),
    email: $("admCondEmail").value.trim(),
    clave: $("admCondClave").value.trim(),
    dias: parseInt($("admCondDias").value, 10) || 30,
    tipo: $("admCondTipo").value,
    marca: $("admCondMarca").value.trim(),
    color: $("admCondColor").value.trim(),
    placa: $("admCondPlaca").value.trim().toUpperCase(),
    pasajeros: parseInt($("admCondPasajeros").value, 10) || 4,
  };
}
$("btnCrearConductor").addEventListener("click", () => {
  const d = leerAdmCond();
  if (!d.nombre || !d.tel || !d.clave) { msg($("admCondMsg"), "Completa nombre, teléfono y clave.", "err"); return; }
  if (!d.tipo) { msg($("admCondMsg"), "Selecciona el tipo de vehículo.", "err"); return; }
  const id = genId();
  db.child("conductores").child(id).set({
    id, nombre: d.nombre, cedula: d.cedula, telefono: d.tel, correo: d.email, clave: d.clave, creado: Date.now(),
    licenciaExp: diasDeAqui(d.dias), licenciaDias: d.dias, estado: "activo",
    tipoVehiculo: d.tipo, marca: d.marca, colorVehiculo: d.color, placa: d.placa, pasajeros: d.pasajeros,
  }).then(() => {
    msg($("admCondMsg"), "✅ Conductor creado. ID: " + id + " · Clave: " + d.clave, "ok");
    ["admCondNombre", "admCondCedula", "admCondTel", "admCondEmail", "admCondClave", "admCondMarca", "admCondColor", "admCondPlaca"].forEach((i) => ($(i).value = ""));
    cargarListaConductores();
  });
});

// ---------- Diseño de tarjetas de conductor (colapsables, texto primero) ----------
function estadoHTML(con) {
  const dl = con.licenciaExp ? daysUntil(con.licenciaExp) : 0;
  let estado;
  if (con.estado === "pendiente") estado = `<span class="badge-pend">⏳ EN REVISIÓN</span>`;
  else if (con.licenciaExp && dl > 0) estado = `<span class="badge-ok">Vigente · ${dl} día${dl === 1 ? "" : "s"}</span>`;
  else estado = `<span class="badge-bad">VENCIDA / SIN LICENCIA</span>`;
  return estado;
}

function renderConductoresLista(contEl, data, filtro) {
  contEl.innerHTML = "";
  let conductores = Object.values(data).sort((a, b) => (b.creado || 0) - (a.creado || 0));
  if (filtro) {
    const f = filtro.toLowerCase();
    conductores = conductores.filter((c) =>
      [c.nombre, c.id, c.telefono, c.cedula, c.correo].some((x) => String(x || "").toLowerCase().includes(f)));
  }
  if (!conductores.length) { contEl.innerHTML = '<div class="trip-card">No hay conductores.</div>'; return; }
  conductores.forEach((con) => {
    const div = document.createElement("div");
    div.className = "cond-card";
    // Vista resumida: solo texto/datos, sin fotos, hasta desplegar
    const fotoMini = con.fotoPerfil
      ? `<img src="${con.fotoPerfil}" alt="" class="rv-avatar sm expand-avatar" data-foto="${escapeHtml(con.fotoPerfil)}" title="Toca para descargar la foto">`
      : "";
    div.innerHTML = `
      <div class="cond-head">
        ${fotoMini}
        <div class="cond-head-text">
          <b>${escapeHtml(con.nombre)}</b>
          <div class="m-mini">${estadoHTML(con)}</div>
          <div class="m-mini">ID: <code>${escapeHtml(con.id)}</code> · ${escapeHtml(con.telefono || "—")}</div>
        </div>
        <button class="btn ghost small" data-desplegar="${con.id}">${"Ver detalle"}</button>
      </div>
      <div class="cond-detalle" data-detalle="${con.id}" style="display:none"></div>
      <div class="btn-row-card" data-acciones="${con.id}">
        <button class="btn primary" data-actualizar="${con.id}">Actualizar 30 días</button>
        <button class="btn wa" data-renovar="${con.id}">Renovar (WA)</button>
        ${con.estado === "pendiente" ? `<button class="btn green" data-activar="${con.id}">Activar cuenta</button>` : ""}
        <button class="btn ghost" data-editar="${con.id}">✏️ Editar</button>
      </div>`;
    contEl.appendChild(div);

    // Desplegar información completa al pulsar
    div.querySelector(`[data-desplegar="${con.id}"]`).addEventListener("click", () => {
      const d = div.querySelector(`[data-detalle="${con.id}"]`);
      const visible = d.style.display === "block";
      if (!visible) {
        const det = [
          ["🚗 Tipo", tiposCache[con.tipoVehiculo]?.nombre || con.tipoVehiculo || "—"],
          ["🚙 Marca", con.marca || "—"], ["🎨 Color", con.colorVehiculo || "—"],
          ["🔤 Placa", con.placa || "—"], ["🧑‍🤝‍🧑 Capacidad", con.pasajeros || "—"],
          ["🪪 Cédula", con.cedula || "—"], ["📧 Correo", con.correo || "—"],
          ["🕒 Registrado", con.creado ? new Date(con.creado).toLocaleString("es-CR") : "—"],
        ].map(([k, v]) => `<div class="m-mini">${k}: ${escapeHtml(v)}</div>`).join("");
        d.innerHTML = det;
        // Fotos: al hacer clic sobre la foto se descarga (se abre) directamente
        const fotos = [["Perfil", con.fotoPerfil], ["Vehículo", con.fotoVehiculo], ["Licencia", con.fotoLicencia], ["Marchamo", con.fotoMarchamo], ["Dekra", con.fotoDekra]].filter(([, u]) => u);
        if (fotos.length) {
          d.innerHTML += '<div class="foto-thumbs">' + fotos.map(([n, u]) =>
            `<a href="${u}" target="_blank" download title="Descargar: ${n}" onclick="event.preventDefault();window.open('${u}','_blank')">` +
            `<img src="${u}" alt="${n}" loading="lazy"><span class="ft-label">${n} · descargar</span></a>`).join("") + "</div>";
        }
        d.style.display = "block";
        div.querySelector(`[data-desplegar="${con.id}"]`).textContent = "Ocultar detalle";
      } else {
        d.style.display = "none";
        div.querySelector(`[data-desplegar="${con.id}"]`).textContent = "Ver detalle";
      }
    });
    // Clic en la foto del avatar la descarga
    div.querySelectorAll("[data-foto]").forEach((img) => {
      img.style.cursor = "pointer";
      img.addEventListener("click", (e) => { e.stopPropagation(); window.open(img.dataset.foto, "_blank"); });
    });
    // Actualizar 30 días en DB + WhatsApp
    div.querySelector(`[data-actualizar="${con.id}"]`).addEventListener("click", async () => {
      if (!confirm(`¿Extender la licencia de ${con.nombre} por 30 días?`)) return;
      const exp = diasDeAqui(30);
      try {
        await db.child("conductores").child(con.id).update({ licenciaExp: exp, licenciaDias: 30, estado: "activo" });
        const texto = `🎉 ¡Hola ${con.nombre}! Tu cuenta de conductor en Viaje Rural fue ACTUALIZADA. Tu licencia fue extendida por 30 días y ya está vigente.`;
        waTel(con.telefono, texto);
      } catch (e) { alert("Error: " + e); }
    });
    // Renovar (enlace por WhatsApp)
    div.querySelector(`[data-renovar="${con.id}"]`).addEventListener("click", () => {
      const token = btoa(`${diasDeAqui(30)}_${con.id}_${SECURE_KEY}`);
      const url = location.origin + location.pathname + "#lic=" + token;
      const texto = `¡Hola ${con.nombre}! Te enviamos el enlace para renovar tu licencia (30 días). Ábrelo y pégalo en tu pantalla de licencia:\n\n${url}`;
      waTel(con.telefono, texto);
    });
    // Activar cuenta pendiente
    div.querySelectorAll(`[data-activar="${con.id}"]`).forEach((b) =>
      b.addEventListener("click", () => activarCuentaConductor(con)));
    // Editar
    div.querySelector(`[data-editar="${con.id}"]`).addEventListener("click", () => editarConductor(con));
  });
}

function activarCuentaConductor(con) {
  if (!confirm(`¿Activar la cuenta de ${con.nombre} (${con.id}) con licencia de 30 días? Se notificará por WhatsApp al instante.`)) return;
  const exp = diasDeAqui(30);
  db.child("conductores").child(con.id).update({ estado: "activo", licenciaExp: exp, licenciaDias: 30 })
    .then(() => {
      // Sin enlaces: se abre WhatsApp con un mensaje predefinido (requerimiento 8)
      const texto = `Su cuenta en Viaje Rural ha sido activada exitosamente por 30 días, vinculada a su ID: ${con.id}`;
      waTel(con.telefono, texto);
    })
    .catch((e) => alert("Error: " + e));
}

let listaCondCache = {};
function cargarListaConductores() {
  db.child("conductores").on("value", (snap) => {
    listaCondCache = snap.val() || {};
    aplicarFiltroConductores();
    cargarDuplicados();
  }, (err) => { $("listaConductores").innerHTML = erroresFirebase(err); });
}
function aplicarFiltroConductores() {
  renderConductoresLista($("listaConductores"), listaCondCache, $("admBuscarConductor").value);
}
$("admBuscarConductor").addEventListener("input", aplicarFiltroConductores);

function cargarListaPendientes() {
  db.child("conductores").orderByChild("estado").equalTo("pendiente").on("value", (snap) => {
    renderConductoresLista($("listaPendientes"), snap.val() || {});
  }, (err) => { $("listaPendientes").innerHTML = erroresFirebase(err); });
}

// ---------- Editar conductor ----------
function editarConductor(con) {
  $("edConId").value = con.id;
  $("edConNombre").value = con.nombre || "";
  $("edConCedula").value = con.cedula || "";
  $("edConTel").value = con.telefono || "";
  $("edConEmail").value = con.correo || "";
  $("edConClave").value = con.clave || "";
  $("edConTipo").value = con.tipoVehiculo || "";
  $("edConMarca").value = con.marca || "";
  $("edConColor").value = con.colorVehiculo || "";
  $("edConPlaca").value = con.placa || "";
  $("edConPasajeros").value = con.pasajeros || tiposCache[con.tipoVehiculo]?.capacidad || 1;
  $("edConDias").value = "";
  $("edConMsg").textContent = "";
  $("editarCondModal").style.display = "flex";
}
$("btnCerrarEditarCond").addEventListener("click", () => ($("editarCondModal").style.display = "none"));
$("btnGuardarEditarCond").addEventListener("click", () => {
  const id = $("edConId").value;
  const em = $("edConMsg");
  if (!id) { msg(em, "Error: sin ID.", "err"); return; }
  const nombre = $("edConNombre").value.trim();
  const tel = $("edConTel").value.trim();
  const clave = $("edConClave").value.trim();
  if (!nombre || !tel || !clave) { msg(em, "Completa nombre, teléfono y clave.", "err"); return; }
  const tipoVehiculo = $("edConTipo").value;
  const pasajeros = parseInt($("edConPasajeros").value, 10);
  if (!tipoVehiculo) { msg(em, "Selecciona el tipo de vehículo.", "err"); return; }
  if (!pasajeros || pasajeros < 1 || pasajeros > 40) { msg(em, "La capacidad debe ser de 1 a 40 pasajeros.", "err"); return; }
  const act = {
    nombre, telefono: tel, cedula: $("edConCedula").value.trim(), correo: $("edConEmail").value.trim(), clave,
    tipoVehiculo, marca: $("edConMarca").value.trim(), colorVehiculo: $("edConColor").value.trim(),
    placa: $("edConPlaca").value.trim().toUpperCase(), pasajeros,
  };
  const dias = parseInt($("edConDias").value, 10);
  if (dias && dias > 0) { act.licenciaExp = diasDeAqui(dias); act.licenciaDias = dias; }
  db.child("conductores").child(id).update(act)
    .then(() => { msg(em, "✅ Conductor actualizado.", "ok"); $("editarCondModal").style.display = "none"; })
    .catch((e) => msg(em, "Error: " + e, "err"));
});

// ---------- Tipos de vehículo ----------
function cargarListaTipos() {
  db.child("tiposVehiculo").on("value", (snap) => {
    const data = snap.val() || {};
    tiposCache = data;
    renderSelectsTipo();
    const cont = $("listaTiposVehiculo"); cont.innerHTML = "";
    Object.entries(data).forEach(([key, t]) => {
      const div = document.createElement("div");
      div.className = "trip-card";
      div.innerHTML =
        `<b>${t.icono || "🚗"} ${escapeHtml(t.nombre || key)}</b>` +
        `<div class="t-mini">Clave: <code>${key}</code> · Capacidad: ${t.capacidad || 4} pasajeros</div>` +
        `<div class="btn-row-card">
           <button class="btn ghost small" data-editartipo="${key}">✏️ Editar</button>
           <button class="btn danger small" data-borrartipo="${key}">🗑 Eliminar</button>
         </div>`;
      cont.appendChild(div);
      // Edición inline
      div.querySelector(`[data-editartipo="${key}"]`).addEventListener("click", () => editarTipo(key, t));
      div.querySelector(`[data-borrartipo="${key}"]`).addEventListener("click", () => {
        if (confirm(`¿Eliminar el tipo "${t.nombre}"? Los conductores con este tipo quedarán sin coincidencias.`)) {
          db.child("tiposVehiculo").child(key).remove();
        }
      });
    });
  }, (err) => { $("listaTiposVehiculo").innerHTML = erroresFirebase(err); });
}

function editarTipo(key, t) {
  const nuevoNom = prompt("Nombre del tipo de vehículo:", t.nombre || key);
  if (nuevoNom === null) return;
  const nuevoIcono = prompt("Icono (emoji):", t.icono || "🚗") || "🚗";
  const nuevaCap = parseInt(prompt("Capacidad de pasajeros:", t.capacidad || 4), 10) || 4;
  db.child("tiposVehiculo").child(key).set({ nombre: nuevoNom.trim() || key, icono: nuevoIcono, capacidad: nuevaCap });
}

$("btnAgregarTipo").addEventListener("click", () => {
  const nombre = $("admTipoNombre").value.trim();
  const icono = $("admTipoIcono").value.trim();
  const cap = parseInt($("admTipoCapacidad").value, 10) || 4;
  const em = $("admTipoMsg");
  if (!nombre) { msg(em, "Escribe el nombre del tipo.", "err"); return; }
  const key = nombre.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20) || "tipo" + Date.now();
  db.child("tiposVehiculo").child(key).set({ nombre, icono: icono || "🚗", capacidad: cap })
    .then(() => { msg(em, "✅ Tipo agregado.", "ok"); $("admTipoNombre").value = ""; $("admTipoIcono").value = ""; })
    .catch((e) => msg(em, "Error: " + e, "err"));
});

// ---------- Duplicados (cédula, teléfono, correo) ----------
function cargarDuplicados() {
  const cont = $("listaDuplicados");
  if (!cont) return;
  const cond = Object.values(listaCondCache);
  const grupos = {};
  ["cedula", "telefono", "correo"].forEach((campo) => {
    const porValor = {};
    cond.forEach((c) => {
      const v = String(c[campo] || "").trim().toLowerCase();
      if (!v) return;
      (porValor[v] = porValor[v] || []).push(c);
    });
    Object.values(porValor).forEach((lista) => {
      if (lista.length > 1) {
        const nombreCampo = { cedula: "Cédula", telefono: "Teléfono/WhatsApp", correo: "Correo electrónico" }[campo];
        grupos[nombreCampo + ": " + lista[0][campo]] = lista;
      }
    });
  });
  cont.innerHTML = "";
  const entradas = Object.entries(grupos);
  if (!entradas.length) { cont.innerHTML = '<div class="trip-card">✅ No se detectaron conductores duplicados.</div>'; return; }
  entradas.forEach(([clave, lista]) => {
    const div = document.createElement("div");
    div.className = "trip-card warning";
    div.innerHTML = `<b>⚠️ Duplicado por ${escapeHtml(clave)}</b>`;
    lista.forEach((c) => {
      div.innerHTML +=
        `<div class="m-mini">• <code>${escapeHtml(c.id)}</code> <b>${escapeHtml(c.nombre)}</b> · ${escapeHtml(c.telefono || "")} · ${escapeHtml(c.creado ? new Date(c.creado).toLocaleDateString("es-CR") : "")}</div>`;
    });
    div.innerHTML += `<div class="btn-row-card"><button class="btn ghost small" data-dup-ids="${lista.map((c) => c.id).join(",")}">Revisar en lista</button></div>`;
    cont.appendChild(div);
    div.querySelector("[data-dup-ids]").addEventListener("click", () => {
      document.querySelectorAll(".admin-tab").forEach((x) => x.classList.remove("active"));
      document.querySelectorAll(".admin-panel").forEach((x) => (x.style.display = "none"));
      $("atab-conductores").style.display = "block";
      document.querySelectorAll(".admin-tab").forEach((x) => { if (x.dataset.atab === "conductores") x.classList.add("active"); });
    });
  });
}

function erroresFirebase(err) {
  const esPermiso = /permission_denied/i.test(String(err.code || err));
  return `<div class="trip-card"><b>⚠ Sin acceso a Firebase</b>
    <div class="t-mini">${esPermiso ? "Las reglas de la Realtime Database deniegan lecturas/escrituras." : String(err)}</div>
    <div class="t-mini">Abre la consola de Firebase → Realtime Database → Reglas y configura el acceso.</div></div>`;
}

function cargarListaPasajeros() {
  db.child("pasajeros").on("value", (snap) => {
    const p = snap.val() || {};
    const cont = $("listaPasajerosAdmin"); cont.innerHTML = "";
    Object.values(p).sort((a, b) => (b.creado || 0) - (a.creado || 0)).forEach((pas) => {
      const div = document.createElement("div");
      div.className = "cond-card";
      div.innerHTML =
        `<b>${escapeHtml(pas.nombre)}</b>` +
        (pas.fotoPerfil ? `<div class="m-mini"><img src="${pas.fotoPerfil}" class="rv-avatar sm" alt=""></div>` : "") +
        `<div class="m-mini">ID: <code>${escapeHtml(pas.id)}</code></div>` +
        `<div class="m-mini">Teléfono: ${escapeHtml(pas.telefono || "—")}</div>` +
        `<div class="m-mini">🕒 Registrado: ${pas.creado ? new Date(pas.creado).toLocaleString("es-CR") : "—"}</div>`;
      cont.appendChild(div);
    });
    if (!Object.keys(p).length) cont.innerHTML = '<div class="trip-card">Aún no hay pasajeros registrados.</div>';
  }, (err) => { $("listaPasajerosAdmin").innerHTML = erroresFirebase(err); });
}

function cargarViajesAdmin() {
  db.child("viajes").on("value", (snap) => {
    const v = snap.val() || {};
    const cont = $("listaViajesAdmin"); cont.innerHTML = "";
    const estados = {
      solicitado: "⏳ Solicitado", aceptado: "✅ Aceptado", iniciado: "🟢 En curso",
      finalizado: "🏁 Finalizado", cancelado: "✖ Cancelado", sin_conductor: "⚠ Sin conductor",
    };
    Object.values(v).sort((a, b) => (b.creado || 0) - (a.creado || 0)).forEach((t) => {
      const div = document.createElement("div");
      div.className = "trip-card";
      div.innerHTML =
        `<b>${t.pasajeroNombre || "—"} → ${t.destTxt || "—"}</b>` +
        `<div class="t-mini">${estados[t.estado] || t.estado}</div>` +
        `<div class="t-mini">💰 ₡${(t.precio || 0).toLocaleString()}</div>` +
        `<div class="t-mini">👤 Conductor: ${t.conductorNombre || "sin asignar"}</div>` +
        `<div class="t-mini">🚗 Tipo: ${tiposCache[t.tipoVehiculo]?.nombre || t.tipoVehiculo || "—"}</div>` +
        `<div class="t-mini">🕒 ${t.creado ? new Date(t.creado).toLocaleString("es-CR") : "—"}</div>`;
      cont.appendChild(div);
    });
  }, (err) => { $("listaViajesAdmin").innerHTML = erroresFirebase(err); });
}

L.Icon.Default.mergeOptions({ iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png" });

// ============================================================
//              CONFIGURACIÓN — PERFIL DE SOLO LECTURA
// ============================================================
let perfilPasajeroDatos = null;
function renderPerfilCard() {
  const card = $("ajsPerfilCard");
  if (!card || !usuario) return;
  let foto = "", rows = [], vehicleRows = [], docs = [];
  if (usuario.rol === "conductor") {
    const c = condDatos || {};
    foto = c.fotoPerfil || iconoAvatarFallback;
    rows = [
      ["ID", c.id], ["Nombre", c.nombre], ["Cédula", c.cedula],
      ["Teléfono (WA)", c.telefono], ["Correo", c.correo],
      ["Clave de acceso", c.clave ? "••••••••" : ""],
      ["Estado", c.estado], ["Días de licencia", c.licenciaExp ? daysUntil(c.licenciaExp) : c.licenciaDias],
      ["Vencimiento de licencia", c.licenciaExp ? darFechaLarga(c.licenciaExp) : ""],
      ["Tarifa por kilómetro", c.tarifaKm ? `₡${Number(c.tarifaKm).toLocaleString()}` : ""],
      ["Fecha de registro", c.creado ? new Date(c.creado).toLocaleString("es-CR") : ""],
    ];
    vehicleRows = [
      ["Tipo", tiposCache[c.tipoVehiculo]?.nombre || c.tipoVehiculo],
      ["Marca", c.marca], ["Color", c.colorVehiculo], ["Placa", c.placa],
      ["Capacidad", c.pasajeros ? `${c.pasajeros} pasajeros` : ""],
    ];
    docs = [["Foto del vehículo", c.fotoVehiculo], ["Licencia", c.fotoLicencia], ["Marchamo", c.fotoMarchamo], ["Revisión técnica (Dekra)", c.fotoDekra]];
  } else if (usuario.rol === "pasajero") {
    const p = perfilPasajeroDatos || JSON.parse(localStorage.getItem("miPasajero") || "{}");
    foto = p.fotoPerfil || iconoAvatarFallback;
    rows = [
      ["ID", p.id], ["Nombre", p.nombre], ["Teléfono (WA)", p.telefono],
      ["Fecha de registro", p.creado ? new Date(p.creado).toLocaleString("es-CR") : ""],
      ["Destinos favoritos", Array.isArray(p.favoritos) && p.favoritos.length ? p.favoritos.map((f) => f.txt).join(", ") : "Ninguno"],
      ...Object.entries(p).filter(([key, value]) =>
        !["id", "nombre", "telefono", "creado", "favoritos", "fotoPerfil", "clave"].includes(key) &&
        (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
      ).map(([key, value]) => [key, value]),
    ];
  } else return;
  card.innerHTML =
    `<div class="profile-heading"><img src="${escapeHtml(foto)}" alt="foto"><b>Información de tu cuenta</b></div>` +
    `<div class="profile-rows">` +
    rows.filter(([k, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `<div class="profile-row"><span>${escapeHtml(k)}</span><b>${escapeHtml(v)}</b></div>`).join("") +
    `</div>` +
    (usuario.rol === "conductor" ?
      `<h4 class="profile-doc-title">Vehículo registrado · solo lectura</h4>` +
      `<div class="profile-rows vehicle-profile-rows">${vehicleRows.filter(([k, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `<div class="profile-row"><span>${escapeHtml(k)}</span><b>${escapeHtml(v)}</b></div>`).join("")}</div>` +
      `<div class="vehicle-change-request"><p>Para cambiar estos datos, envía una solicitud al administrador.</p><textarea id="ajsSolicitudVehiculo" rows="3" maxlength="500" placeholder="Describe los cambios que necesitas"></textarea><button id="btnSolicitarCambioVehiculo" class="btn ghost">Solicitar cambio al administrador</button></div>`
      : "") +
    (docs.some(([, url]) => url) ? `<h4 class="profile-doc-title">Documentos</h4><div class="profile-docs">${docs.filter(([, url]) => url).map(([name, url]) => `<a href="${escapeHtml(url)}" target="_blank" rel="noopener"><img src="${escapeHtml(url)}" alt=""><span>${escapeHtml(name)}</span></a>`).join("")}</div>` : "");
  const btnSolicitud = card.querySelector("#btnSolicitarCambioVehiculo");
  if (btnSolicitud) btnSolicitud.addEventListener("click", () => {
    const detalle = card.querySelector("#ajsSolicitudVehiculo").value.trim();
    if (!detalle) { msg($("ajsMsg"), "Describe qué datos del vehículo deseas cambiar.", "err"); return; }
    const c = condDatos || {};
    waSoporte(`Solicitud de cambio de vehículo en Viaje Rural.\nID: ${c.id || usuario.id}\nConductor: ${c.nombre || usuario.nombre}\nVehículo actual: ${(tiposCache[c.tipoVehiculo]?.nombre || c.tipoVehiculo || "—")} · ${[c.marca, c.colorVehiculo, c.placa].filter(Boolean).join(" / ")} · ${c.pasajeros || "—"} pasajeros\nCambio solicitado: ${detalle}`);
    msg($("ajsMsg"), "Se abrió WhatsApp para enviar tu solicitud al administrador.", "ok");
  });
}

function abrirAjustes() {
  if (!usuario) return;
  const modal = $("ajustesModal");
  modal.querySelectorAll("label").forEach((label) => {
    if (label.closest(".modal-card") === modal.querySelector(".modal-card")) label.style.display = "none";
  });
  ["ajsNombre", "ajsFotoWrap", "ajsTarifaWrap", "ajsClave", "btnGuardarAjustes"].forEach((id) => { $(id).style.display = "none"; });
  renderPerfilCard();
  $("ajsMsg").textContent = "";
  const esCond = usuario.rol === "conductor";
  $("btnFinanzasAjustes").style.display = esCond ? "block" : "none";
  if (esCond && !condDatos) {
    db.child("conductores").child(usuario.id).once("value", (s) => {
      const c = s.val(); if (c) { condDatos = { ...c }; renderPerfilCard(); }
      if (c) $("ajsTarifaKm").value = c.tarifaKm != null ? c.tarifaKm : "";
    });
  }
  $("ajustesModal").style.display = "flex";
}
$("btnAjustesCond").addEventListener("click", () => {
  if (usuario?.rol === "conductor") {
    db.child("conductores").child(usuario.id).once("value", (s) => {
      const c = s.val(); if (c) condDatos = { ...c, id: c.id || usuario.id };
      abrirAjustes();
    });
  } else abrirAjustes();
});
$("btnAjustesPas").addEventListener("click", async () => {
  if (usuario?.rol === "pasajero") {
    const snap = await db.child("pasajeros").child(usuario.id).once("value").catch(() => null);
    perfilPasajeroDatos = snap?.val() || JSON.parse(localStorage.getItem("miPasajero") || "{}");
  }
  abrirAjustes();
});
$("btnCerrarAjustes").addEventListener("click", () => ($("ajustesModal").style.display = "none"));

$("btnGuardarAjustes").addEventListener("click", async () => {
  const em = $("ajsMsg");
  if (!usuario) return;
  const nombre = $("ajsNombre").value.trim();
  const clave = $("ajsClave").value.trim();
  if (!nombre) { msg(em, "El nombre no puede estar vacío.", "err"); return; }
  let foto = null;
  const f = $("ajsFoto").files[0];
  if (f) { msg(em, "Subiendo foto...", "ok"); foto = await subirImagen(f).catch(() => null); }
  const act = {};
  if (nombre !== usuario.nombre) act.nombre = nombre;
  if (clave) act.clave = clave;
  if (foto) act.fotoPerfil = foto;
  if (usuario.rol === "conductor" && $("ajsTarifaKm").value.trim() !== "") act.tarifaKm = parseFloat($("ajsTarifaKm").value) || 0;

  if (usuario.rol === "conductor") {
    await db.child("conductores").child(usuario.id).update(act).catch((e) => msg(em, "Error: " + e, "err"));
    if (act.nombre) { usuario.nombre = nombre; $("conductorNombre").textContent = nombre; }
    if (act.clave || act.nombre || act.fotoPerfil) {
      db.child("conductores").child(usuario.id).once("value", (s) => {
        const c = s.val(); if (c) condDatos = { ...c, id: c.id || usuario.id };
      });
    }
    guardarSesion();
    renderPerfilCard();
    msg(em, "✅ Configuración guardada.", "ok");
  } else if (usuario.rol === "pasajero") {
    await db.child("pasajeros").child(usuario.id).update(act).catch((e) => msg(em, "Error: " + e, "err"));
    const p = JSON.parse(localStorage.getItem("miPasajero") || "{}");
    p.nombre = nombre; if (clave) p.clave = clave; if (foto) p.fotoPerfil = foto;
    localStorage.setItem("miPasajero", JSON.stringify(p));
    usuario.nombre = nombre;
    $("pasajeroNombre").textContent = nombre;
    guardarSesion();
    renderPerfilCard();
    msg(em, "✅ Configuración guardada.", "ok");
  }
});

// ============================================================
//              HISTORIAL DEL CONDUCTOR
// ============================================================
$("btnHistorialCond").addEventListener("click", () => {
  $("historialModalTitle").textContent = "🗺️ Historial de viajes realizados";
  $("historialModal").style.display = "flex";
  const cont = $("listaHistorialCond");
  cont.innerHTML = '<div class="trip-card"><span>Cargando...</span></div>';
  db.child("viajes").orderByChild("conductorId").equalTo(usuario.id).once("value", (snap) => {
    const v = snap.val() || {};
    cont.innerHTML = "";
    const realizados = Object.values(v).filter((t) => t.estado === "finalizado").sort((a, b) => (b.finEn || b.creado || 0) - (a.finEn || a.creado || 0));
    if (!realizados.length) { cont.innerHTML = '<div class="trip-card"><span>Aún no has realizado viajes.</span></div>'; return; }
    realizados.forEach((t) => {
      const div = document.createElement("div");
      div.className = "trip-card";
      div.innerHTML =
        `<b>👤 ${escapeHtml(t.pasajeroNombre || "—")}</b>` +
        `<div class="t-mini">📍 <small>${escapeHtml(t.origenTxt || "")}</small></div>` +
        `<div class="t-mini">🏁 <small>${escapeHtml(t.destTxt || "")}</small></div>` +
        `<div class="t-mini">💰 ₡${(t.precio || 0).toLocaleString()}</div>` +
        `<div class="t-mini">🕒 ${t.finEn ? new Date(t.finEn).toLocaleString("es-CR") : (t.creado ? new Date(t.creado).toLocaleString("es-CR") : "—")}</div>`;
      cont.appendChild(div);
    });
  });
});
$("btnCerrarHistorial").addEventListener("click", () => ($("historialModal").style.display = "none"));

// ============================================================
//              DESTINOS FAVORITOS DEL PASAJERO
// ============================================================
let misFavs = [];
function renderFavoritos() {
  const c = $("favChips"); if (!c) return;
  c.innerHTML = "";
  if (!misFavs.length) {
    c.innerHTML = '<span class="t-mini" style="margin:0">Sin favoritos. Toca ⭐ junto al destino o una estrella en tus viajes.</span>';
    return;
  }
  misFavs.forEach((f, idx) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    const txt = document.createElement("span");
    txt.textContent = "⭐ " + f.txt;
    const rm = document.createElement("i");
    rm.className = "chip-rm"; rm.textContent = "✕";
    rm.onclick = (e) => { e.stopPropagation(); misFavs.splice(idx, 1); guardarFavoritos(); renderFavoritos(); };
    chip.appendChild(txt); chip.appendChild(rm);
    chip.onclick = () => { destSelecc = { lat: f.lat, lng: f.lng, txt: f.txt }; $("inpDestino").value = f.txt; };
    c.appendChild(chip);
  });
}
function guardarFavoritos() {
  if (usuario?.rol === "pasajero") db.child("pasajeros").child(usuario.id).update({ favoritos: misFavs });
}
function agregarFavorito(lat, lng, txt) {
  if (!txt) return;
  if (!misFavs.some((f) => f.txt === txt)) misFavs.push({ lat, lng, txt });
  guardarFavoritos(); renderFavoritos();
}
$("btnGuardarFav").addEventListener("click", () => {
  if (!destSelecc) { alert("Busca y selecciona un destino para guardarlo como favorito."); return; }
  agregarFavorito(destSelecc.lat, destSelecc.lng, destSelecc.txt);
});

// ============================================================
//              VIAJES REALIZADOS / AGREGAR FAVORITO
// ============================================================
$("btnViajesPas").addEventListener("click", () => {
  $("viajesPasModal").style.display = "flex";
  const cont = $("listaViajesPasajero");
  cont.innerHTML = '<div class="trip-card"><span>Cargando...</span></div>';
  db.child("viajes").orderByChild("pasajeroId").equalTo(usuario.id).once("value", (snap) => {
    const v = snap.val() || {};
    cont.innerHTML = "";
    const realizados = Object.values(v).filter((t) => t.estado === "finalizado").sort((a, b) => (b.finEn || b.creado || 0) - (a.finEn || a.creado || 0));
    if (!realizados.length) { cont.innerHTML = '<div class="trip-card"><span>Aún no has realizado viajes.</span></div>'; return; }
    realizados.forEach((t) => {
      const div = document.createElement("div");
      div.className = "trip-card";
      div.innerHTML =
        `<b>🏁 ${escapeHtml(t.destTxt || "—")}</b>` +
        `<div class="t-mini">📍 <small>${escapeHtml(t.origenTxt || "")}</small></div>` +
        `<div class="t-mini">👤 Conductor: ${escapeHtml(t.conductorNombre || "—")}</div>` +
        `<div class="t-mini">💰 ₡${(t.precio || 0).toLocaleString()}</div>` +
        `<div class="t-mini">🕒 ${t.finEn ? new Date(t.finEn).toLocaleString("es-CR") : "—"}</div>` +
        `<button class="btn primary small" data-favtrip="${t.id}">⭐ Agregar como destino favorito</button>`;
      cont.appendChild(div);
    });
    cont.querySelectorAll("[data-favtrip]").forEach((b) => {
      b.addEventListener("click", () => {
        const t = Object.values(v).find((x) => x.id === b.dataset.favtrip);
        if (t && t.destLat) { agregarFavorito(t.destLat, t.destLng, t.destTxt); b.textContent = "✅ Agregado a favoritos"; b.disabled = true; }
      });
    });
  });
});
$("btnCerrarViajesPas").addEventListener("click", () => ($("viajesPasModal").style.display = "none"));

// ============================================================
//               INICIO
// ============================================================
cargarTiposVehiculo(() => {
  renderSelectsTipo();
  restaurarSesion();
});

console.log("Viaje Rural listo.");

// ✅ BLOQUE 1 aplicado
// ✅ BLOQUE 2 aplicado
// ✅ BLOQUE 3 aplicado
