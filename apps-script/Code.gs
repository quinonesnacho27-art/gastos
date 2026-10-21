// Gastos & Ahorro — backend. Pega TODO este archivo en Code.gs (reemplaza lo que haya).
// Luego ejecuta la función setup una vez.

// ===== CORE: lógica compartida entre el backend (Apps Script) y la app =====
var CORE = (function () {
  function norm(s) {
    return String(s == null ? '' : s).toLowerCase().normalize('NFD')
      .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9&]+/g, ' ').trim();
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmtLocal(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' +
      pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }
  function parseLocal(s) {
    if (s instanceof Date) return s;
    var m = String(s || '').match(/(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (!m) return new Date(NaN);
    return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  }

  // Número "chileno": 12.990 = doce mil novecientos noventa; 1,5 = uno coma cinco
  function parseNum(tok) {
    var s = String(tok == null ? '' : tok).replace(/[^\d.,-]/g, '');
    if (!s) return NaN;
    if (/^-?\d{1,3}([.,]\d{3})+$/.test(s)) return parseFloat(s.replace(/[.,]/g, ''));
    var last = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
    if (last >= 0) {
      var dec = s.length - last - 1;
      if (dec >= 1 && dec <= 2) return parseFloat(s.slice(0, last).replace(/[.,]/g, '') + '.' + s.slice(last + 1));
    }
    return parseFloat(s.replace(/[.,]/g, ''));
  }
  function parseAmount(v) {
    if (typeof v === 'number') return Math.round(v);
    var n = parseNum(v);
    return isNaN(n) ? 0 : Math.round(Math.abs(n));
  }

  var ACRON = { kfc: 'KFC', tag: 'TAG', 'h&m': 'H&M', pc: 'PC', bip: 'Bip', ikea: 'IKEA', cae: 'CAE', usa: 'USA', jbl: 'JBL', ok: 'OK' };
  function titleCase(s) {
    return String(s).toLowerCase().split(/\s+/).filter(Boolean).map(function (w) {
      if (ACRON[w]) return ACRON[w];
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(' ');
  }
  function cleanMerchant(raw) {
    var s = String(raw || '').trim();
    s = s.replace(/^(MERPAGO|MERCADOPAGO|MPAGO|DP|SUMUP|PAYU|TUU|KLAP|FLOW|GETNET|SQ)\s*\*\s*/i, '');
    s = s.replace(/\*/g, ' ').replace(/\s{2,}/g, ' ').trim();
    if (!s) return 'Sin comercio';
    if (s === s.toUpperCase()) s = titleCase(s);
    return s;
  }

  // Clave para "recordar" un comercio: primera palabra si es larga, si no, dos palabras.
  function ruleKey(comercio) {
    var n = norm(comercio);
    if (/^transf/.test(n)) return n;
    var w = n.split(' ');
    if (w[0] && w[0].length >= 5) return w[0];
    return w.slice(0, 2).join(' ');
  }

  // Regla más específica (patrón más largo) que calce al inicio de una palabra
  // Regla más específica que calce al inicio de una palabra. Una regla con "monto" solo aplica a ese monto exacto y gana a las demás.
  function categorize(text, reglas, monto) {
    var t = ' ' + norm(text) + ' ', best = null, bl = 0;
    (reglas || []).forEach(function (r) {
      var p = norm(r.patron);
      if (!p || t.indexOf(' ' + p) < 0) return;
      var rm = Number(r.monto) || 0;
      if (rm && Math.round(Number(monto) || 0) !== rm) return;
      var score = p.length + (rm ? 1000 : 0);
      if (score > bl) { best = r; bl = score; }
    });
    return best;
  }

  function walletMedio(card, medios) {
    var c = norm(card);
    if (!c) return null;
    var hit = null;
    (medios || []).forEach(function (m) {
      String(m.aliasWallet || '').split(',').forEach(function (a) {
        a = norm(a);
        if (a && c.indexOf(a) >= 0 && !hit) hit = m.id;
      });
    });
    return hit;
  }

  function findDup(txs, tx, mins) {
    var t = parseLocal(tx.fecha).getTime(), m = Number(tx.monto);
    if (!(m > 0)) return null;
    for (var i = txs.length - 1; i >= 0; i--) {
      var x = txs[i];
      if (x.id === tx.id || x.fuente === tx.fuente) continue;
      if (Math.abs(Number(x.monto) - m) >= 1) continue;
      if (Math.abs(parseLocal(x.fecha).getTime() - t) <= mins * 60000) return x;
    }
    return null;
  }

  // ---------- Voz / texto libre ----------
  var UN = { cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
    diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18,
    diecinueve: 19, veinte: 20, veintiun: 21, veintiuno: 21, veintidos: 22, veintitres: 23, veinticuatro: 24,
    veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29, treinta: 30, cuarenta: 40,
    cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90, cien: 100, ciento: 100, doscientos: 200,
    doscientas: 200, trescientos: 300, trescientas: 300, cuatrocientos: 400, quinientos: 500, quinientas: 500,
    seiscientos: 600, setecientos: 700, ochocientos: 800, novecientos: 900, media: 0.5, medio: 0.5 };
  var MULT_MIL = { mil: 1, luca: 1, lucas: 1, lukas: 1, luka: 1 };
  var MULT_MM = { millon: 1, millones: 1, palo: 1, palos: 1, melon: 1, melones: 1 };
  var FILLER = ('gaste gasto compre pague pago en de del el la los las un una por pesos peso con para y me al a mi hoy que ' +
    'unos unas tarjeta credito debito efectivo cash cuotas cuota itau chile banco cuenta corriente rut ingreso recibi ' +
    'ahorre abone deposite sueldo pagaron transfirieron depositaron se fue ayer anteayer antier sin interes plata').split(' ');

  function vozTokens(text) {
    return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9.,$ñ]+/g, ' ').split(/\s+/).map(function (t) {
        return t.replace(/^\$/, '').replace(/[.,]+$/, '');
      }).filter(Boolean);
  }
  function isNumTok(t) { return /^\d+([.,]\d+)*k?$/.test(t) || UN.hasOwnProperty(t) || MULT_MIL[t] || MULT_MM[t]; }

  function numberRuns(tok) {
    var runs = [], i = 0;
    while (i < tok.length) {
      if (!isNumTok(tok[i]) || ((tok[i] === 'medio' || tok[i] === 'media') && !(i > 0 && (MULT_MIL[tok[i - 1]] || MULT_MM[tok[i - 1]] || tok[i - 1] === 'y')))) { i++; continue; }
      var start = i, total = 0, cur = 0, any = false;
      while (i < tok.length) {
        var t = tok[i];
        if (t === 'y' && any && i + 1 < tok.length && isNumTok(tok[i + 1]) && !MULT_MIL[tok[i + 1]] && !MULT_MM[tok[i + 1]]) {
          // "mil y quinientos", "treinta y cinco", "luca y media"
          i++; continue;
        }
        if (/^\d+([.,]\d+)*k$/.test(t)) { cur += parseNum(t.slice(0, -1)) * 1000; any = true; i++; continue; }
        if (/^\d/.test(t)) { cur += parseNum(t); any = true; i++; continue; }
        if (UN.hasOwnProperty(t)) {
          if ((t === 'media' || t === 'medio') && total >= 1000 && cur === 0) { total += total >= 1e6 ? 5e5 : 500; i++; continue; }
          cur += UN[t]; any = true; i++; continue;
        }
        if (MULT_MIL[t]) { total += (cur || 1) * 1000; cur = 0; any = true; i++; continue; }
        if (MULT_MM[t]) { total = (total + (cur || 1)) * 1e6; cur = 0; any = true; i++; continue; }
        break;
      }
      runs.push({ start: start, end: i, value: Math.round(total + cur) });
    }
    return runs;
  }

  function pickMedio(tok, joined, tipoPago, ctx) {
    var cfg = ctx.config || {}, medios = ctx.medios || [];
    var has = function (w) { return tok.indexOf(w) >= 0; };
    if (has('efectivo') || has('cash') || has('billete')) return 'efectivo';
    var want = null;
    if (has('credito') || has('tarjeta') || tipoPago) want = 'credito';
    if (has('debito') || /cuenta (corriente|rut|vista)/.test(joined) || has('rut')) want = 'debito';
    var bank = has('itau') ? 'itau' : (has('chile') ? 'chile' : null);
    if (!want && !bank) return cfg.medioVoz || 'efectivo';
    var cands = medios.filter(function (m) {
      var tipoOk = !want || (want === 'credito' ? m.tipo === 'credito' : (m.tipo === 'debito' || m.tipo === 'cuenta'));
      return tipoOk && (!bank || norm(m.banco).indexOf(bank) >= 0);
    });
    if (cands.length) return cands[0].id;
    if (want === 'credito') return cfg.medioCredito || 'efectivo';
    return cfg.medioDebito || cfg.medioVoz || 'efectivo';
  }

  function parseVoz(text, ctx) {
    ctx = ctx || {};
    var now = parseLocal(ctx.now || fmtLocal(new Date()));
    var tok = vozTokens(text), joined = ' ' + tok.join(' ') + ' ';
    var cuotas = 1, i;
    // cuotas: "en 3 cuotas"
    for (i = 1; i < tok.length; i++) {
      if (/^cuotas?$/.test(tok[i])) {
        var v = /^\d+$/.test(tok[i - 1]) ? +tok[i - 1] : UN[tok[i - 1]];
        if (v >= 1 && v <= 48) { cuotas = v; tok.splice(i - 1, 2); break; }
      }
    }
    var dias = 0;
    if (tok.indexOf('anteayer') >= 0 || tok.indexOf('antier') >= 0) dias = 2;
    else if (tok.indexOf('ayer') >= 0) dias = 1;
    var fecha = new Date(now.getTime() - dias * 86400000);

    var tipo = 'gasto';
    if (/ (ingreso|recibi|me pagaron|sueldo|me depositaron|me transfirieron|me devolvieron) /.test(joined)) tipo = 'ingreso';
    else if (/ (pague|pago|abone) (la |mi )?tarjeta /.test(joined)) tipo = 'pago_tarjeta';
    else if (/ (ahorre|ahorro|abone|abono|deposite|invert\w*|aporte) /.test(joined)) tipo = 'ahorro';

    var medio = pickMedio(tok, joined, tipo === 'pago_tarjeta', ctx);

    var runs = numberRuns(tok), best = null;
    runs.forEach(function (r) { if (!best || r.value > best.value) best = r; });
    var monto = best ? best.value : 0;
    var rest = tok.filter(function (t, k) { return !(best && k >= best.start && k < best.end); })
      .filter(function (t) { return FILLER.indexOf(t) < 0 && !isNumTok(t); });
    var desc = rest.join(' ').trim();

    var categoria = 'Otros', matched = false;
    if (tipo === 'ingreso') { categoria = 'Ingresos'; matched = true; }
    else if (tipo === 'pago_tarjeta') { categoria = 'Pago tarjeta'; matched = true; }
    else if (tipo === 'ahorro') {
      categoria = 'Ahorro e inversión'; matched = true;
      (ctx.metas || []).forEach(function (m) {
        norm(m.nombre).split(' ').forEach(function (w) {
          if (w.length > 3 && joined.indexOf(' ' + w) >= 0) categoria = m.nombre;
          if (w === 'papa' && joined.indexOf(' papa') >= 0) categoria = m.nombre;
        });
      });
    } else {
      var r = categorize(text, ctx.reglas);
      if (r) { categoria = r.categoria; matched = true; if (r.tipo) tipo = r.tipo; }
    }
    var comercio = desc ? desc.charAt(0).toUpperCase() + desc.slice(1) :
      (tipo === 'ingreso' ? 'Ingreso' : tipo === 'ahorro' ? 'Ahorro' : tipo === 'pago_tarjeta' ? 'Pago tarjeta' : 'Gasto');
    return {
      fecha: fmtLocal(fecha), monto: monto, comercio: comercio, categoria: categoria, medio: medio, tipo: tipo,
      cuotas: cuotas, nota: 'Voz: ' + String(text || '').trim(), fuente: 'voz',
      estado: (monto > 0 && matched) ? 'ok' : 'revisar'
    };
  }

  // ---------- Correos del banco ----------
  function htmlToText(html) {
    return String(html || '')
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>|<\/(td|th|tr|p|div|li|h\d)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#36;|&dollar;/g, '$')
      .replace(/&aacute;/g, 'á').replace(/&eacute;/g, 'é').replace(/&iacute;/g, 'í').replace(/&oacute;/g, 'ó')
      .replace(/&uacute;/g, 'ú').replace(/&ntilde;/g, 'ñ').replace(/&Ntilde;/g, 'Ñ').replace(/&#(\d+);/g, function (_, c) { return String.fromCharCode(+c); })
      .replace(/[ \t\r]+/g, ' ').replace(/\n\s*/g, '\n').trim();
  }
  function medioByLast4(l4, medios, tipoHint) {
    var hit = null;
    (medios || []).forEach(function (m) { if (String(m.ultimos4) === String(l4) && !hit) hit = m.id; });
    return hit || ((tipoHint === 'credito' ? 'tc' : 'cta') + '****' + l4);
  }
  function lineAfter(text, label) {
    var re = new RegExp(label + '[\\s|:]*([^\\n|]+)', 'i');
    var m = text.match(re);
    return m ? m[1].split(/\s+(Rut|E-mail|Banco|Cuenta|Tipo)\b/)[0].trim() : '';
  }
  function shortName(n) {
    var w = titleCase(String(n || '').trim()).split(' ');
    if (w.length >= 3) return w[0] + ' ' + w[w.length >= 4 ? 2 : 1];
    return w.join(' ');
  }

  // from, subject, body (texto plano), dateStr (fecha local del correo), ctx {medios, reglas, config}
  function parseBankEmail(from, subject, body, dateStr, ctx) {
    ctx = ctx || {};
    var cfg = ctx.config || {};
    var f = String(from || '').toLowerCase();
    var flat = String(body || '').replace(/\s+/g, ' ');
    var m;
    // Banco de Chile: compra con tarjeta o cargo en cuenta
    m = flat.match(/compra por \$\s?([\d.,]+) con (Tarjeta de Cr[eé]dito|Tarjeta de D[eé]bito|cargo a Cuenta) \*+(\d{4}) en (.+?) el (\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})/i);
    if (m) {
      var esTC = /cr[eé]dito/i.test(m[2]);
      var comercio = cleanMerchant(m[4]);
      var r = categorize(comercio, ctx.reglas, parseAmount(m[1]));
      if (r && r.nombre) comercio = r.nombre;
      return {
        fecha: m[7] + '-' + m[6] + '-' + m[5] + 'T' + m[8] + ':' + m[9] + ':00', monto: parseAmount(m[1]),
        comercio: comercio, categoria: r ? r.categoria : 'Otros', medio: medioByLast4(m[3], ctx.medios, esTC ? 'credito' : 'cuenta'),
        tipo: r && r.tipo ? r.tipo : 'gasto', cuotas: 1, nota: m[4].trim(), fuente: 'email', estado: r ? 'ok' : 'revisar'
      };
    }
    // Itaú: comprobante de transferencia enviada por ti
    if (/itau/.test(f) && /comprobante electr[oó]nico de transferencia/i.test(flat)) {
      var fm = flat.match(/Fecha - Hora[\s|:]*(\d{2})[\/-](\d{2})[\/-](\d{4})[\s-]+(\d{2}):(\d{2}):?(\d{2})?/i);
      var mm = flat.match(/Monto:?[\s|]*\$\s?([\d.,]+)/i);
      if (!mm) return null;
      var nombre = lineAfter(body, 'Nombre');
      var cuentaDest = (flat.match(/Cuenta de destino[\s|:]*(\d+)/i) || [])[1] || '';
      var propias = String(cfg.cuentasPropias || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
      var esPropia = propias.some(function (p) { return cuentaDest && cuentaDest.slice(-p.length) === p; });
      var comercioT = esPropia ? 'Traspaso a cuenta propia' : 'Transf. a ' + shortName(nombre || 'tercero');
      var rr = esPropia ? null : categorize(comercioT, ctx.reglas, parseAmount(mm[1]));
      if (rr && rr.nombre) comercioT = rr.nombre;
      return {
        fecha: fm ? fm[3] + '-' + fm[2] + '-' + fm[1] + 'T' + fm[4] + ':' + fm[5] + ':' + (fm[6] || '00') : dateStr,
        monto: parseAmount(mm[1]), comercio: comercioT,
        categoria: esPropia ? 'Movimiento interno' : (rr ? rr.categoria : 'Transferencias'),
        medio: cfg.medioDebito || 'itau_cc', tipo: esPropia ? 'transferencia' : (rr && rr.tipo ? rr.tipo : 'gasto'), cuotas: 1,
        nota: 'Transferencia Itaú' + (nombre ? ' a ' + nombre : ''), fuente: 'email', estado: (esPropia || rr) ? 'ok' : 'revisar'
      };
    }
    // Itaú: alguien te transfirió (aviso al destinatario)
    if (/itau/.test(f) && /ha instruido una transferencia/i.test(flat)) {
      var cli = (flat.match(/cliente ([^,]+?)\s*,\s*ha instruido/i) || [])[1] || '';
      var titular = norm(cfg.nombreTitular || '');
      if (titular && norm(cli).indexOf(titular) >= 0) return null; // copia de tu propia transferencia
      var m2 = flat.match(/Monto:?[\s|]*\$\s?([\d.,]+)/i);
      var f2 = flat.match(/con fecha (\d{2})\/(\d{2})\/(\d{4})-(\d{2}):(\d{2}):(\d{2})/i);
      if (!m2) return null;
      return {
        fecha: f2 ? f2[3] + '-' + f2[2] + '-' + f2[1] + 'T' + f2[4] + ':' + f2[5] + ':' + f2[6] : dateStr,
        monto: parseAmount(m2[1]), comercio: 'Transf. de ' + shortName(cli), categoria: 'Ingresos',
        medio: cfg.medioDebito || 'itau_cc', tipo: 'ingreso', cuotas: 1, nota: 'Transferencia recibida', fuente: 'email', estado: 'ok'
      };
    }
    return null;
  }

  // ---------- Importar cartolas y estados de tarjeta Itaú (.xls) ----------
  var MESES3 = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, oct: 10, nov: 11, dic: 12 };
  function ymd(v) {
    if (typeof v === 'number' && v > 20000) { var d = new Date(Math.round((v - 25569) * 86400000)); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
    if (v instanceof Date) return v.getFullYear() + '-' + pad(v.getMonth() + 1) + '-' + pad(v.getDate());
    var s = String(v == null ? '' : v), m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    return m ? m[3] + '-' + m[2] + '-' + m[1] : null;
  }
  function cnum(v) { if (typeof v === 'number') return v; var s = String(v == null ? '' : v).trim(); if (!s || s === '0.') return 0; var n = parseNum(s); return isNaN(n) ? 0 : n; }
  function findCell(rows, re) {
    for (var i = 0; i < rows.length; i++) for (var j = 0; j < (rows[i] || []).length; j++) {
      var c = rows[i][j]; if (c != null && re.test(String(c))) return { i: i, j: j, v: String(c) };
    }
    return null;
  }
  var PREF = /^(mercadopago|merpago|mpago|mp|tuu|sumup|redgloba|payscan|fudo|flo|dp|payu|getnet|klap)(?:\s+|(?=[a-z0-9]))/i;
  var PREFN = { mercadopago: 'Mercado Pago', merpago: 'Mercado Pago', mpago: 'Mercado Pago', mp: 'Mercado Pago', tuu: 'Tuu', sumup: 'SumUp', redgloba: 'Redglobal', payscan: 'Payscan', fudo: 'Fudo', flo: 'Flo' };
  function shortMerchant(raw) {
    var s = String(raw || '').replace(/\s{2,}/g, ' ').trim(), m = s.match(PREF);
    if (m) {
      var rest = s.slice(m[0].length).trim(), pre = PREFN[m[1].toLowerCase()];
      if (rest.length >= 8 || !pre) s = rest || s;
      else s = pre + ' ' + cleanMerchant(rest.toUpperCase());
      if (/^Mercado Pago|^Tuu|^SumUp|^Redglobal|^Payscan|^Fudo|^Flo/.test(s)) return s;
    }
    return cleanMerchant(s.toUpperCase());
  }
  function personName(desc) {
    var m = String(desc).match(/^transf\w*\.?\s+(?:a|de)\s+(.+)$/i);
    return m ? titleCase(m[1].trim()) : '';
  }

  function classifyCartola(desc, monto, esAbono, f, ctx) {
    var cfg = ctx.config || {}, n = norm(desc), pila = norm(cfg.nombrePila || '');
    var tx = { fecha: f + 'T12:00:00', monto: Math.round(monto), cuotas: 1, fuente: 'cartola', estado: 'ok', medio: ctx.medioCC || cfg.medioDebito || 'itau_cc', nota: String(desc).replace(/\s{2,}/g, ' ').trim(), tipo: 'gasto', categoria: 'Otros', comercio: '' };
    var set = function (o) { for (var k in o) tx[k] = o[k]; return tx; };
    if (pila && new RegExp('^transf\\w* (a|de) ' + pila + '( |$)').test(n)) return set({ tipo: 'transferencia', categoria: 'Movimiento interno', comercio: 'Traspaso entre tus cuentas' });
    if (/^abono desde linea de credito/.test(n)) return set({ tipo: 'transferencia', categoria: 'Movimiento interno', comercio: 'Uso línea de crédito' });
    if (esAbono) {
      if (/^(remuneraciones|anticipos)/.test(n)) return set({ tipo: 'ingreso', categoria: 'Sueldo', comercio: /^anticipo/.test(n) ? 'Anticipo de sueldo' : 'Sueldo' });
      if (/^abono iol ctas itau/.test(n)) {
        var dia = +f.slice(8, 10);
        return dia >= 20 ? set({ tipo: 'ingreso', categoria: 'Sueldo', comercio: 'Sueldo' }) : set({ tipo: 'ingreso', categoria: 'Ingresos', comercio: 'Abono Itaú', estado: 'revisar' });
      }
      if (/^transf/.test(n)) {
        var ri = categorize('Transf. de ' + personName(desc), (ctx.reglas || []).filter(function (x) { return x.tipo === 'ingreso'; }), monto);
        return set({ tipo: 'ingreso', categoria: ri ? ri.categoria : 'Ingresos', comercio: ri && ri.nombre ? ri.nombre : 'Transf. de ' + personName(desc) });
      }
      if (/devolucion/.test(n)) return set({ tipo: 'ingreso', categoria: 'Ingresos', comercio: titleCase(String(desc).replace(/\d{5,}/g, '').trim()) });
      return set({ tipo: 'ingreso', categoria: 'Ingresos', comercio: titleCase(String(desc).trim()) });
    }
    if (/^pago tarjeta de credito|^pago deuda inter/.test(n)) return set({ tipo: 'pago_tarjeta', categoria: 'Pago tarjeta', medio: cfg.medioCredito || 'itau_tc', comercio: /inter/.test(n) ? 'Pago tarjeta (internacional)' : 'Pago tarjeta de crédito' });
    if (/^giro en cajero/.test(n)) return set({ categoria: 'Giros de efectivo', comercio: 'Giro en cajero' });
    var comercio;
    if (/^transf/.test(n)) comercio = 'Transf. a ' + personName(desc);
    else if (/\sC$/.test(String(desc).trim()) || String(desc).length >= 28) comercio = shortMerchant(String(desc).slice(0, 17));
    else comercio = cleanMerchant(String(desc).replace(/\s+\d{6,}\s*$/, '').toUpperCase());
    var r = categorize(comercio + ' ' + desc, ctx.reglas, monto);
    if (r && r.nombre) comercio = r.nombre;
    set({ comercio: comercio, categoria: r ? r.categoria : (/^transf/.test(n) ? 'Transferencias' : 'Otros'), tipo: r && r.tipo ? r.tipo : 'gasto' });
    if (!r && monto >= 150000) tx.estado = 'revisar';
    if (r && monto >= 300000 && /Supermercado|Restaurantes|Café|Otros/.test(r.categoria)) tx.estado = 'revisar';
    return tx;
  }

  function importCartola(rows, ctx) {
    var per = findCell(rows, /\d{2}-[A-Za-z]{3}-\d{4}\s*-\s*\d{2}-[A-Za-z]{3}-\d{4}/);
    var pm = per ? per.v.match(/\d{2}-([A-Za-z]{3})-(\d{4})\s*-\s*\d{2}-([A-Za-z]{3})-(\d{4})/) : null;
    var y0 = pm ? +pm[2] : new Date().getFullYear(), m0 = pm ? MESES3[pm[1].toLowerCase()] : 1, y1 = pm ? +pm[4] : y0;
    var cta = findCell(rows, /^N[uú]mero de Cuenta$/i), cuenta = cta ? String((rows[cta.i] || [])[cta.j + 1] || '') : '';
    if (!/\d{4}/.test(cuenta)) { var c2 = findCell(rows, /^\d{8,12}$/); cuenta = c2 ? c2.v : ''; }
    var l4 = cuenta.slice(-4), medio = null;
    (ctx.medios || []).forEach(function (m) { if (!medio && String(m.ultimos4) === l4) medio = m.id; });
    ctx = Object.assign({}, ctx, { medioCC: medio || (ctx.config || {}).medioDebito || 'itau_cc' });
    var h = -1;
    for (var i = 0; i < rows.length; i++) { var r = rows[i] || []; if (String(r[0]).trim() === 'Fecha' && /movimiento/i.test(String(r[2]))) { h = i; break; } }
    var txs = [], seen = {}, saldos = {};
    for (var k = h + 1; h >= 0 && k < rows.length; k++) {
      var row = rows[k] || [], fm = String(row[0] == null ? '' : row[0]).trim().match(/^(\d{2})\/(\d{2})$/);
      if (!fm) continue;
      var mes = +fm[2], yr = (y1 > y0 && mes >= m0) ? y0 : y1, f = yr + '-' + fm[2] + '-' + fm[1];
      var cargo = cnum(row[3]), abono = cnum(row[4]), desc = String(row[2] || '').trim();
      if (!cargo && !abono) continue;
      var tx = classifyCartola(desc, cargo || abono, !cargo, f, ctx);
      var key = 'cc' + l4 + ':' + f + ':' + String(row[1] || '').replace(/\.0$/, '') + ':' + (cargo ? cargo : -abono) + ':' + norm(desc).slice(0, 20);
      seen[key] = (seen[key] || 0) + 1;
      tx.ref = key + ':' + seen[key];
      txs.push(tx);
      if (row[5] !== null && row[5] !== '' && row[5] != null) saldos[f.slice(0, 7)] = cnum(row[5]);
    }
    return { tipo: 'cartola', cuenta: l4, desde: txs.length ? txs[0].fecha.slice(0, 10) : null, hasta: txs.length ? txs[txs.length - 1].fecha.slice(0, 10) : null, txs: txs, cuotas: [], saldos: saldos };
  }

  function importTarjeta(rows, ctx) {
    var cfg = ctx.config || {}, usd = Number(cfg.usdClp) || 960;
    var t = findCell(rows, /\*{4}.*\d{4}\s*$/), l4 = t ? t.v.replace(/\D/g, '').slice(-4) : '';
    var medio = null;
    (ctx.medios || []).forEach(function (m) { if (!medio && l4 && String(m.ultimos4) === l4) medio = m.id; });
    medio = medio || cfg.medioCredito || 'itau_tc';
    var val = function (re, off) { var c = findCell(rows, re); return c ? (rows[c.i] || [])[c.j + (off || 1)] : null; };
    var meta = { cupoTotal: cnum(val(/^Cupo total$/i)), cupoUtilizado: cnum(val(/^Cupo utilizado$/i)), facturado: cnum(val(/^Monto facturado$/i)), vence: val(/^Fecha de vencimiento$/i), ultimaFact: val(/^Fecha [uú]ltima facturaci/i) };
    var txs = [], cuotas = [], canjes = [], seen = {}, intl = false;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i] || [], c0 = String(r[0] == null ? '' : r[0]);
      if (/no facturados internacionales/i.test(c0)) intl = true;
      if (/no facturados nacionales/i.test(c0)) intl = false;
      var fc = ymd(r[0]);
      if (!fc || /fecha/i.test(c0)) continue;
      var desc = String(r[2] || '').trim(), monto = intl ? cnum(r[4]) : cnum(r[5]);
      if (!desc || !monto) continue;
      if (/^MONTO CANCELADO/i.test(desc)) continue;
      if (/ABONO CANJE/i.test(desc)) { canjes.push(Math.abs(monto)); continue; }
      var cm = desc.match(/\s(\d{1,2})-(\d{1,2})\s+CUOTA/i) || (String(r[4] || '').match(/^(\d{1,2})\/(\d{1,2})$/) && /CUOTA/i.test(desc) ? String(r[4]).match(/^(\d{1,2})\/(\d{1,2})$/) : null);
      if (cm) {
        var proc = ymd(r[1]) || fc;
        cuotas.push({ descripcion: cleanMerchant(desc.replace(/\s+\d{1,2}-\d{1,2}\s+CUOTA.*$/i, '').toUpperCase()) + ' (compra ' + fc.slice(8, 10) + '/' + fc.slice(5, 7) + '/' + fc.slice(0, 4) + ')', medio: medio, montoCuota: Math.round(monto), cuotasRestantes: (+cm[2]) - (+cm[1]) + 1, desde: proc.slice(0, 7) });
        continue;
      }
      var name = desc.replace(/\s+COMPRAS.*$/i, '');
      var comercio = shortMerchant(name);
      var clp = intl ? Math.round(monto * usd) : Math.round(monto);
      var rr = categorize(comercio + ' ' + name, ctx.reglas, intl ? 0 : monto);
      if (rr && rr.nombre) comercio = rr.nombre;
      var key = 'tc' + l4 + ':' + fc + ':' + monto + ':' + norm(name).slice(0, 20);
      seen[key] = (seen[key] || 0) + 1;
      txs.push({ fecha: fc + 'T12:00:00', monto: clp, comercio: comercio, categoria: rr ? rr.categoria : 'Otros', medio: medio, tipo: rr && rr.tipo ? rr.tipo : 'gasto', cuotas: 1, nota: intl ? 'US$ ' + monto + ' a $' + usd : name, fuente: 'tarjeta', estado: rr ? 'ok' : 'revisar', ref: key + ':' + seen[key] });
    }
    // un canje de puntos anula la compra del mismo monto
    canjes.forEach(function (a) { var j = txs.findIndex(function (x) { return x.monto === Math.round(a) && !x._x; }); if (j >= 0) txs[j]._x = 1; });
    txs = txs.filter(function (x) { return !x._x; });
    return { tipo: 'tarjeta', cuenta: l4, medio: medio, txs: txs, cuotas: cuotas, meta: meta, canjes: canjes.length };
  }

  function importItau(rows, ctx) {
    ctx = ctx || {};
    if (findCell(rows, /Resumen tarjeta de cr[eé]dito/i)) return importTarjeta(rows, ctx);
    if (findCell(rows, /Cartola Hist[oó]rica|Saldo anterior cuenta corriente/i)) return importCartola(rows, ctx);
    return null;
  }

  // Deja fuera lo que ya existe: misma ref, o mismo monto/tipo/día que un movimiento registrado por otra vía
  function dedupImport(existing, incoming) {
    var refs = {}, byDay = {};
    existing.forEach(function (t) {
      if (t.ref) refs[t.ref] = 1;
      if (t.fuente !== 'cartola' && t.fuente !== 'tarjeta') { var k = String(t.fecha).slice(0, 10) + '|' + Math.round(Number(t.monto)) + '|' + t.tipo; byDay[k] = (byDay[k] || 0) + 1; }
    });
    var out = [], dup = 0;
    incoming.forEach(function (t) {
      if (refs[t.ref]) { dup++; return; }
      var k = String(t.fecha).slice(0, 10) + '|' + Math.round(Number(t.monto)) + '|' + t.tipo;
      if (byDay[k]) { byDay[k]--; dup++; return; }
      refs[t.ref] = 1; out.push(t);
    });
    return { nuevos: out, duplicados: dup };
  }

  return {
    importItau: importItau, dedupImport: dedupImport, ymd: ymd,
    norm: norm, fmtLocal: fmtLocal, parseLocal: parseLocal, parseNum: parseNum, parseAmount: parseAmount,
    cleanMerchant: cleanMerchant, titleCase: titleCase, ruleKey: ruleKey, categorize: categorize,
    walletMedio: walletMedio, findDup: findDup, parseVoz: parseVoz, htmlToText: htmlToText, parseBankEmail: parseBankEmail
  };
})();
if (typeof module !== 'undefined') module.exports = CORE;

// ===== Datos iniciales (se pueden editar después en la planilla o en la app) =====
var SEEDS = (function () {
  var categorias = [
    // nombre, emoji, presupuesto mensual, grupo
    ['Supermercado', '🛒', 140000, 'necesidad'],
    ['Restaurantes y delivery', '🍔', 110000, 'deseo'],
    ['Café y snacks', '☕', 30000, 'deseo'],
    ['Bencina', '⛽', 110000, 'necesidad'],
    ['Auto', '🚗', 50000, 'necesidad'],
    ['Transporte', '🚕', 30000, 'necesidad'],
    ['Salud y farmacia', '💊', 30000, 'necesidad'],
    ['Compras y ropa', '🛍️', 60000, 'deseo'],
    ['Ocio y salidas', '🎉', 60000, 'deseo'],
    ['Suscripciones', '📺', 25000, 'deseo'],
    ['Hogar y regalos', '🎁', 25000, 'deseo'],
    ['Otros', '❓', 30000, 'deseo'],
    ['Transferencias', '↗️', 0, 'deseo'],
    ['Deudas y créditos', '🏦', 0, 'fijo'],
    ['Seguros', '🛡️', 0, 'fijo'],
    ['Giros de efectivo', '💵', 0, 'deseo'],
    ['Sueldo', '💼', 0, 'ingreso'],
    ['Ingresos', '💰', 0, 'ingreso'],
    ['Ahorro e inversión', '📈', 0, 'ahorro'],
    ['Pago tarjeta', '💳', 0, 'interno'],
    ['Movimiento interno', '🔁', 0, 'interno']
  ].map(function (r) { return { nombre: r[0], emoji: r[1], presupuesto: r[2], grupo: r[3] }; });

  var R = {
    'Supermercado': 'hip lider,lid ,dg lider,express consistor,spid,almacen,unimarc,jumbo,tottus,santa isabel,lider,jumbo,unimarc,tottus,santa isabel,isa plaza,acuenta,ekono,alvi,mayorista,cornershop,supermercado,super,feria,verduras,verduleria,carniceria,panaderia,almacen,minimarket,el trebol',
    'Restaurantes y delivery': 'niu sushi,guacamole,boulevard nva,las perdices,meltpizzas,melt,burger king,burgazo,brioche,el peruano,bk gran,comtrisalspa,rincon,uber eats,rappi,pedidosya,pedidos ya,mcdonald,kfc,burger king,juan maestro,dominos,papa john,pizza,telepizza,sushi,doggis,tarragona,wendys,subway,taco bell,restaurant,restoran,la barra,fuente,sangucheria,almuerzo,cena,colacion,completo,churrasco,shawarma,empanada,delivery,comida,propina',
    'Café y snacks': 'tabaqueria,botilleria,think coffee,go acai,snackcenter,starbucks,juan valdez,dunkin,cafe,coffee,oxxo,ok market,pronto,upita,castano,gelateria,helado,snack,bebida,agua,cerveza,copete',
    'Bencina': 'copec,shell,aramco,petrobras,enex,terpel,bencina,gasolina,combustible,diesel',
    'Auto': 'transf a comercializado,municipalidad,ojo mecanico,transf a ojo mecanico,ital frenos,serviteca,prt ,planta revision,permiso de circulacion,frenos,autofact,autopista,costanera norte,vespucio,autopase,autoclave,estacionamiento,parking,lavado,velizwagen,revision tecnica,mantencion,neumatico,lubricentro,peaje,tag,taller,repuesto,salfa,kaufmann,derco',
    'Transporte': 'payu uber,red movilidad,uber,cabify,didi,indriver,beat,metro,bip,red movilidad,micro,taxi,turbus,pullman,latam,sky airline,jetsmart,bus',
    'Salud y farmacia': 'servicios medico,medical shop,farmaoferta,cruz verde,salcobrand,ahumada,farmacia,dr simi,clinica,integramedica,redsalud,laboratorio,optica,dentista,medico,doctor,remedio,isapre',
    'Compras y ropa': 'maconline,ripley webpay,hc quilin,outlet,paseo quilin,mall paseo,plaza sur,falabella,paris,ripley,h&m,zara,mercadolibre,mercado libre,aliexpress,temu,shein,amazon,hites,la polar,adidas,nike,decathlon,pc factory,tecnobox,ropa,zapatilla,polera,pantalon,parque arauco,costanera center',
    'Ocio y salidas': 'atton,hotel,bahia lilen,cabanas,airbnb,booking,cinepolis,cine,cinemark,cineplanet,hoyts,puntoticket,ticketmaster,passline,pub,discoteque,steam,playstation,xbox,nintendo,carrete,concierto,entrada,bowling',
    'Suscripciones': 'anthropic claude,google g1,netflix,spotify,disney,hbo,prime video,apple com,icloud,youtube,chatgpt,openai,anthropic,smart fit,smartfit,gimnasio,entel,movistar,wom,claro,vtr,mundo pacifico,google one',
    'Hogar y regalos': 'servipag,bdp servipag,tienda de mascota,geomaskota,mascota,veterinaria,mr party,chocolates,sodimac,easy,homecenter,ikea,enel,aguas andinas,metrogas,abastible,lipigas,gasco,regalo,cumpleanos,flores,ferreteria',
    'Deudas y créditos': 'pago cuota prestamo,scotiabank cae,seguro degravamen',
    'Movimiento interno': 'traspaso a cuenta propia'
  };
  var reglas = [];
  Object.keys(R).forEach(function (cat) {
    R[cat].split(',').forEach(function (p) {
      reglas.push({ patron: p.trim(), categoria: cat, tipo: cat === 'Movimiento interno' ? 'transferencia' : '', monto: '', nombre: '' });
    });
  });

  var medios = [
    { id: 'itau_tc', nombre: 'Tarjeta de crédito Itaú', tipo: 'credito', banco: 'Itaú', ultimos4: '', cupo: '', diaCorte: 25, diaPago: 5, incluye: 'SI', aliasWallet: '' },
    { id: 'itau_cc', nombre: 'Cuenta corriente Itaú', tipo: 'debito', banco: 'Itaú', ultimos4: '', cupo: '', diaCorte: '', diaPago: '', incluye: 'SI', aliasWallet: '' },
    { id: 'bch_cc', nombre: 'Cuenta Banco de Chile', tipo: 'debito', banco: 'Banco de Chile', ultimos4: '', cupo: '', diaCorte: '', diaPago: '', incluye: 'SI', aliasWallet: '' },
    { id: 'bch_tc', nombre: 'Tarjeta de crédito Banco de Chile', tipo: 'credito', banco: 'Banco de Chile', ultimos4: '', cupo: '', diaCorte: 22, diaPago: 5, incluye: 'SI', aliasWallet: '' },
    { id: 'efectivo', nombre: 'Efectivo', tipo: 'efectivo', banco: '', ultimos4: '', cupo: '', diaCorte: '', diaPago: '', incluye: 'SI', aliasWallet: '' }
  ];

  var fijos = [
    { nombre: 'Plan celular', monto: 15990, dia: 10, categoria: 'Suscripciones', medio: 'itau_tc', patron: 'entel', activo: 'SI' }
  ];

  var metas = [
    { nombre: 'Fondo de emergencia', emoji: '🛟', objetivo: 2000000, inicial: 0, prioridad: 1 },
    { nombre: 'Inversión', emoji: '📈', objetivo: 0, inicial: 0, prioridad: 2 }
  ];

  var config = {
    sueldo: 1500000, diaInicioMes: 25, medioVoz: 'efectivo', medioDebito: 'itau_cc', medioCredito: 'itau_tc',
    cuentasPropias: '', nombreTitular: '', nombrePila: '', montoHormiga: 5000, usdClp: 960, saldosItau: ''
  };

  return { categorias: categorias, reglas: reglas, medios: medios, fijos: fijos, metas: metas, cuotas: [], config: config };
})();
// Combina los datos base con los datos personales (archivo privado Personal.gs, que no se publica)
function mergeSeeds(base, p) {
  var o = JSON.parse(JSON.stringify(base));
  if (!p) return o;
  (p.categorias || []).forEach(function (c) { var i = o.categorias.findIndex(function (x) { return x.nombre === c.nombre; }); if (i >= 0) o.categorias[i] = c; else o.categorias.splice(o.categorias.length - 4, 0, c); });
  o.reglas = (p.reglas || []).concat(o.reglas);
  Object.keys(p.medios || {}).forEach(function (id) { var m = o.medios.find(function (x) { return x.id === id; }); if (m) Object.assign(m, p.medios[id]); });
  if (p.fijos) o.fijos = p.fijos;
  if (p.metas) o.metas = p.metas;
  if (p.cuotas) o.cuotas = p.cuotas;
  Object.assign(o.config, p.config || {});
  return o;
}
if (typeof module !== 'undefined') { module.exports = SEEDS; module.exports.mergeSeeds = mergeSeeds; }

// ===== BACKEND: Google Apps Script (pegar en Extensiones → Apps Script de tu planilla) =====
const TZ = 'America/Santiago';
const HEAD = {
  Movimientos: ['id', 'fecha', 'monto', 'comercio', 'categoria', 'medio', 'tipo', 'cuotas', 'nota', 'fuente', 'estado', 'ref', 'creado'],
  Categorias: ['nombre', 'emoji', 'presupuesto', 'grupo'],
  Reglas: ['patron', 'categoria', 'tipo', 'monto', 'nombre'],
  Medios: ['id', 'nombre', 'tipo', 'banco', 'ultimos4', 'cupo', 'diaCorte', 'diaPago', 'incluye', 'aliasWallet'],
  Fijos: ['nombre', 'monto', 'dia', 'categoria', 'medio', 'patron', 'activo'],
  Metas: ['nombre', 'emoji', 'objetivo', 'inicial', 'prioridad'],
  Cuotas: ['descripcion', 'medio', 'montoCuota', 'cuotasRestantes', 'desde'],
  Config: ['clave', 'valor']
};
const EDITABLES = ['Categorias', 'Reglas', 'Medios', 'Fijos', 'Metas', 'Cuotas', 'Config'];
// La planilla: la del script vinculado o, si el script es independiente, la de SHEET_ID (Personal.gs) o la propiedad SHEET_ID
function book() {
  const a = SpreadsheetApp.getActive();
  if (a) return a;
  const id = (typeof SHEET_ID !== 'undefined' && SHEET_ID) || PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('Falta SHEET_ID: el script no está vinculado a una planilla');
  return SpreadsheetApp.openById(id);
}
const REMITENTES = 'from:(enviodigital@bancochile.cl OR transferencias@itau.cl OR itaupersonas@itau.cl)';

// ---------- Menú en la planilla ----------
function onOpen() {
  SpreadsheetApp.getUi().createMenu('💸 Gastos')
    .addItem('1. Configurar (primera vez)', 'setup')
    .addItem('Leer correos del banco ahora', 'leerCorreosAhora')
    .addItem('Ver token y URL', 'verToken')
    .addToUi();
}

// ---------- Web app ----------
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.action) return json(safeHandle(p));
  try { return HtmlService.createHtmlOutputFromFile('Index').setTitle('Gastos').addMetaTag('viewport', 'width=device-width, initial-scale=1'); }
  catch (err) { return ContentService.createTextOutput('Backend de Gastos funcionando ✅'); }
}
function doPost(e) {
  let p = {};
  const raw = (e && e.postData && e.postData.contents) || '';
  try { p = JSON.parse(raw || '{}'); } catch (err) { p = { text: raw }; }
  p = Object.assign({}, (e && e.parameter) || {}, p);
  const r = safeHandle(p);
  // Los Atajos del iPhone reciben solo el mensaje, listo para mostrar en la notificación
  if ((p.action === 'applepay' || p.action === 'voz') && !truthy(p.dryRun) && p.formato !== 'json') return ContentService.createTextOutput(r.msg || (r.ok ? 'OK' : 'Error'));
  return json(r);
}
function json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function safeHandle(p) {
  try { return handle(p); } catch (err) { return { ok: false, error: String(err && err.message || err), msg: '⚠️ Error: ' + (err && err.message || err) }; }
}
function truthy(v) { return v === true || v === 'true' || v === 1 || v === '1' || v === 'si'; }

function handle(p) {
  const token = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!token || String(p.token || '').trim() !== token) return { ok: false, error: 'token', msg: '🔒 Token inválido' };
  const a = p.action || 'ping';
  if (a === 'ping') return { ok: true, now: nowStr(), msg: 'Conectado ✅' };
  if (a === 'all') return { ok: true, data: allData(), now: nowStr() };
  if (a === 'voz' && truthy(p.dryRun)) return { ok: true, tx: CORE.parseVoz(p.text, ctx()) };
  return withLock(function () {
    switch (a) {
      case 'applepay': return applePay(p);
      case 'voz': { const c = ctx(); const tx = CORE.parseVoz(p.text, c); return saveNew(tx, c); }
      case 'add': return { ok: true, tx: upsertTx(p.tx) };
      case 'update': return updateTx(p);
      case 'delete': deleteTx(p.id); return { ok: true };
      case 'saveTable':
        if (EDITABLES.indexOf(p.tabla) < 0) throw new Error('Tabla no editable: ' + p.tabla);
        writeTable(p.tabla, p.tabla === 'Config' ? objToRows(p.rows) : p.rows);
        return { ok: true };
      case 'importBatch': {
        const d = CORE.dedupImport(readTable('Movimientos'), (p.txs || []).map(completeTx));
        appendRows('Movimientos', d.nuevos);
        return { ok: true, nuevos: d.nuevos.length, duplicados: d.duplicados };
      }
      case 'syncEmail': return { ok: true, nuevos: scanEmail(Number(p.dias) || 7) };
      default: throw new Error('Acción desconocida: ' + a);
    }
  });
}
function withLock(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try { return fn(); } finally { lock.releaseLock(); }
}

// ---------- Tablas ----------
function sh(name) { return book().getSheetByName(name); }
function readTable(name) {
  const s = sh(name);
  if (!s || s.getLastRow() < 2) return [];
  const v = s.getRange(1, 1, s.getLastRow(), s.getLastColumn()).getValues();
  const h = v.shift();
  return v.filter(r => r.some(c => c !== '' && c !== null)).map(r => {
    const o = {};
    h.forEach((k, i) => { let x = r[i]; if (x instanceof Date) x = Utilities.formatDate(x, TZ, "yyyy-MM-dd'T'HH:mm:ss"); o[k] = x; });
    return o;
  });
}
function writeTable(name, rows) {
  const s = sh(name), h = HEAD[name];
  if (s.getLastRow() > 1) s.getRange(2, 1, s.getLastRow() - 1, Math.max(s.getLastColumn(), h.length)).clearContent();
  if (rows && rows.length) s.getRange(2, 1, rows.length, h.length).setValues(rows.map(r => h.map(k => r[k] == null ? '' : r[k])));
}
function appendRows(name, rows) {
  if (!rows.length) return;
  const s = sh(name), h = HEAD[name];
  s.getRange(s.getLastRow() + 1, 1, rows.length, h.length).setValues(rows.map(r => h.map(k => r[k] == null ? '' : r[k])));
}
function rowsToObj(rows) { const o = {}; rows.forEach(r => { if (r.clave) o[r.clave] = r.valor; }); return o; }
function objToRows(o) { return Array.isArray(o) ? o : Object.keys(o).map(k => ({ clave: k, valor: o[k] })); }
function nowStr() { return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ss"); }
function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function ctx() {
  return { reglas: readTable('Reglas'), medios: readTable('Medios'), metas: readTable('Metas'), config: rowsToObj(readTable('Config')), now: nowStr() };
}
function allData() {
  const desde = Utilities.formatDate(new Date(Date.now() - 400 * 86400000), TZ, "yyyy-MM-dd");
  return {
    mov: readTable('Movimientos').filter(t => String(t.fecha) >= desde),
    categorias: readTable('Categorias'), reglas: readTable('Reglas'), medios: readTable('Medios'), fijos: readTable('Fijos'),
    metas: readTable('Metas'), cuotas: readTable('Cuotas'), config: rowsToObj(readTable('Config'))
  };
}

// ---------- Movimientos ----------
function completeTx(tx) {
  const n = nowStr();
  tx.id = tx.id || newId();
  tx.fecha = tx.fecha || n; tx.creado = tx.creado || n;
  tx.monto = CORE.parseAmount(tx.monto); tx.cuotas = Number(tx.cuotas) || 1;
  tx.tipo = tx.tipo || 'gasto'; tx.estado = tx.estado || 'ok'; tx.fuente = tx.fuente || 'manual';
  tx.categoria = tx.categoria || 'Otros';
  return tx;
}
function catEmoji(nombre) { const c = readTable('Categorias').find(x => x.nombre === nombre); return c ? c.emoji : '•'; }
function fmtCLP(n) { return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
function msgFor(tx) {
  if (!(tx.monto > 0)) return '🤔 No entendí el monto. Quedó por revisar en la app: ' + tx.comercio;
  const base = fmtCLP(tx.monto) + ' · ' + tx.comercio;
  if (tx.estado === 'revisar') return '📝 ' + base + ' → por clasificar en la app';
  return '✅ ' + base + ' → ' + catEmoji(tx.categoria) + ' ' + tx.categoria + (tx.cuotas > 1 ? ' (' + tx.cuotas + ' cuotas)' : '');
}
function saveNew(tx) {
  completeTx(tx);
  appendRows('Movimientos', [tx]);
  return { ok: true, tx: tx, msg: msgFor(tx) };
}
function applePay(p) {
  const c = ctx();
  const card = String(p.card || p.name || '').trim();
  const comercio = CORE.cleanMerchant(p.merchant || 'Apple Pay');
  const medio = CORE.walletMedio(card, c.medios) || ('wallet:' + (card || 'Apple Pay'));
  const monto = CORE.parseAmount(p.amount);
  const rule = CORE.categorize(comercio, c.reglas, monto);
  const tx = completeTx({
    fecha: c.now, monto: monto, comercio: comercio, categoria: rule ? rule.categoria : 'Otros', medio: medio,
    tipo: rule && rule.tipo ? rule.tipo : 'gasto', fuente: 'applepay', nota: card ? 'Wallet: ' + card : '',
    estado: rule && monto > 0 ? 'ok' : 'revisar'
  });
  const dup = CORE.findDup(readTable('Movimientos'), tx, 45);
  if (dup) return { ok: true, tx: dup, msg: '✔︎ Ya registrado: ' + fmtCLP(dup.monto) + ' · ' + dup.comercio };
  appendRows('Movimientos', [tx]);
  return { ok: true, tx: tx, msg: msgFor(tx) };
}
function findRow(id) {
  const s = sh('Movimientos'); if (s.getLastRow() < 2) return -1;
  const ids = s.getRange(2, 1, s.getLastRow() - 1, 1).getValues().map(r => String(r[0]));
  const i = ids.indexOf(String(id));
  return i < 0 ? -1 : i + 2;
}
function upsertTx(tx) {
  completeTx(tx);
  const row = findRow(tx.id);
  if (row < 0) { appendRows('Movimientos', [tx]); return tx; }
  sh('Movimientos').getRange(row, 1, 1, HEAD.Movimientos.length).setValues([HEAD.Movimientos.map(k => tx[k] == null ? '' : tx[k])]);
  return tx;
}
// p: {id, fields, aprender: patron | true}
function updateTx(p) {
  const s = sh('Movimientos'), h = HEAD.Movimientos;
  const row = findRow(p.id);
  if (row < 0) throw new Error('No encontré el movimiento ' + p.id);
  const cur = {}; s.getRange(row, 1, 1, h.length).getValues()[0].forEach((v, i) => cur[h[i]] = v);
  const f = p.fields || {};
  Object.keys(f).forEach(k => { if (h.indexOf(k) >= 0 && k !== 'id') cur[k] = f[k]; });
  if (cur.fecha instanceof Date) cur.fecha = Utilities.formatDate(cur.fecha, TZ, "yyyy-MM-dd'T'HH:mm:ss");
  if (f.categoria && !f.estado) cur.estado = 'ok';
  s.getRange(row, 1, 1, h.length).setValues([h.map(k => cur[k] == null ? '' : cur[k])]);
  const cambios = [];
  if (p.aprender && cur.categoria) {
    const patron = typeof p.aprender === 'string' && p.aprender !== 'true' ? CORE.norm(p.aprender) : CORE.ruleKey(cur.comercio);
    learnRule(patron, cur.categoria, f.tipo || '');
    // aplica a los otros movimientos por revisar con el mismo comercio
    const all = readTable('Movimientos');
    all.forEach((t, i) => {
      if (t.id !== cur.id && t.estado === 'revisar' && (' ' + CORE.norm(t.comercio) + ' ').indexOf(' ' + patron) >= 0) {
        s.getRange(i + 2, h.indexOf('categoria') + 1).setValue(cur.categoria);
        s.getRange(i + 2, h.indexOf('estado') + 1).setValue('ok');
        cambios.push(t.id);
      }
    });
  }
  // si un medio "wallet:xxx" se asigna a un medio real, recordar el alias
  if (f.medio && String(p.walletAlias || '').length) learnWallet(f.medio, p.walletAlias);
  return { ok: true, tx: cur, cambios: cambios };
}
function learnRule(patron, categoria, tipo) {
  if (!patron) return;
  const reglas = readTable('Reglas').filter(r => CORE.norm(r.patron) !== patron);
  reglas.push({ patron: patron, categoria: categoria, tipo: tipo || '' });
  writeTable('Reglas', reglas);
}
function learnWallet(medioId, alias) {
  const medios = readTable('Medios');
  const m = medios.find(x => x.id === medioId); if (!m) return;
  const list = String(m.aliasWallet || '').split(',').map(x => x.trim()).filter(Boolean);
  if (list.indexOf(alias) < 0) list.push(alias);
  m.aliasWallet = list.join(',');
  writeTable('Medios', medios);
  // reasigna los movimientos antiguos de esa tarjeta
  const s = sh('Movimientos'), h = HEAD.Movimientos;
  readTable('Movimientos').forEach((t, i) => { if (t.medio === 'wallet:' + alias) s.getRange(i + 2, h.indexOf('medio') + 1).setValue(medioId); });
}
function deleteTx(id) { const row = findRow(id); if (row > 0) sh('Movimientos').deleteRow(row); }

// ---------- Correos del banco ----------
function scanEmail(dias) {
  const c = ctx();
  const txs = readTable('Movimientos');
  const refs = {}; txs.forEach(t => { if (t.ref) refs[t.ref] = 1; });
  const vistos = JSON.parse(PropertiesService.getScriptProperties().getProperty('EMAIL_IGNORADOS') || '[]');
  const ign = {}; vistos.forEach(x => ign[x] = 1);
  const nuevos = [], ignorados = [];
  GmailApp.search(REMITENTES + ' newer_than:' + dias + 'd', 0, 300).forEach(th => th.getMessages().forEach(m => {
    const ref = 'gm:' + m.getId();
    if (refs[ref] || ign[ref]) return;
    const fecha = Utilities.formatDate(m.getDate(), TZ, "yyyy-MM-dd'T'HH:mm:ss");
    const body = CORE.htmlToText(m.getBody()) || m.getPlainBody();
    const tx = CORE.parseBankEmail(m.getFrom(), m.getSubject(), body, fecha, c);
    if (!tx) { ignorados.push(ref); return; }
    tx.ref = ref;
    const dup = CORE.findDup(txs.concat(nuevos), tx, 45);
    if (dup && dup.fuente === 'applepay') {
      const f = { ref: ref };
      if (String(dup.medio).indexOf('wallet:') === 0) { f.medio = tx.medio; }
      updateTx({ id: dup.id, fields: f, walletAlias: String(dup.medio).indexOf('wallet:') === 0 ? String(dup.medio).slice(7) : '' });
      refs[ref] = 1; return;
    }
    if (dup) { refs[ref] = 1; return; }
    completeTx(tx); nuevos.push(tx); refs[ref] = 1;
  }));
  appendRows('Movimientos', nuevos);
  if (ignorados.length) PropertiesService.getScriptProperties().setProperty('EMAIL_IGNORADOS', JSON.stringify(vistos.concat(ignorados).slice(-400)));
  return nuevos.length;
}
function emailTrigger() { withLock(() => scanEmail(2)); }
function leerCorreosAhora() {
  const n = withLock(() => scanEmail(30));
  book().toast(n + ' movimientos nuevos desde tus correos', 'Gastos', 6);
}

// ---------- Configuración inicial ----------
function setup() {
  const ss = book();
  ss.setSpreadsheetTimeZone(TZ);
  const B = mergeSeeds(SEEDS, typeof PERSONAL !== 'undefined' ? PERSONAL : null);
  const seeds = {
    Movimientos: [], Categorias: B.categorias, Reglas: B.reglas, Medios: B.medios, Fijos: B.fijos,
    Metas: B.metas, Cuotas: B.cuotas, Config: objToRows(B.config)
  };
  Object.keys(HEAD).forEach(name => {
    let s = sh(name);
    if (!s) {
      s = ss.insertSheet(name);
      s.getRange(1, 1, 1, HEAD[name].length).setValues([HEAD[name]]).setFontWeight('bold').setBackground('#DCEBEA');
      s.setFrozenRows(1);
      if (seeds[name].length) appendRows(name, seeds[name]);
    }
  });
  sh('Movimientos').getRange('B:B').setNumberFormat('@');
  const def = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1 && def.getLastRow() === 0) ss.deleteSheet(def);

  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('TOKEN')) props.setProperty('TOKEN', Utilities.getUuid().replace(/-/g, '').slice(0, 20));

  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === 'emailTrigger') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('emailTrigger').timeBased().everyMinutes(10).create();

  const n = withLock(() => scanEmail(60));
  const msg = 'Listo ✅\n\nImporté ' + n + ' movimientos de tus correos (últimos 60 días).\n\nTU TOKEN: ' + props.getProperty('TOKEN') +
    '\n\nAhora: Implementar → Nueva implementación → Aplicación web (Ejecutar como: yo · Acceso: cualquier persona) y copia la URL.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { }
}
function verToken() {
  const t = PropertiesService.getScriptProperties().getProperty('TOKEN') || '(corre "Configurar" primero)';
  let url = ''; try { url = ScriptApp.getService().getUrl() || ''; } catch (e) { }
  const msg = 'Token: ' + t + '\n\nURL de la aplicación web: ' + (url || '(aún no implementada)');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { }
}
