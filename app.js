// =============================================================================
// app.js — Lógica Central do Sonoplastia App
// VERSÃO ESTÁVEL — base para implementações futuras
// =============================================================================

import { db } from "./firebase-config.js";

import {
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
  setDoc,
  doc,
  serverTimestamp,
  writeBatch,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// =============================================================================
// CONSTANTES
// =============================================================================

const COLECAO_ROTEIRO = "roteiro";

const roteiroQuery = query(
  collection(db, COLECAO_ROTEIRO),
  orderBy("ordem", "asc")
);

// =============================================================================
// DETECÇÃO DE PÁGINA
// =============================================================================

const isOperador = document.getElementById("roteiro-list") !== null;
const isProjecao = document.getElementById("projecao-container") !== null;

// Expõe atualizarVolume globalmente para o slider HTML poder chamar
// (precisa estar antes do iniciarOperador)
window.atualizarVolume = atualizarVolume;

if (isOperador) iniciarOperador();
if (isProjecao)  iniciarProjecao();

// =============================================================================
//   MÓDULO: PAINEL DO OPERADOR (index.html)
// =============================================================================

// ---------------------------------------------------------------------------
// Modo de operação atual (lido do Firestore — config/app)
// Padrão: 'estendida' enquanto não carrega
// ---------------------------------------------------------------------------
let _modoAtual = "estendida";

function iniciarOperador() {
  window.abrirProjecao    = abrirProjecao;
  window.pararTudo        = pararTudo;
  window.adicionarYoutube = adicionarYoutube;
  window.atualizarVolume  = atualizarVolume;
  window.colarLink        = colarLink;
  window.abrirYoutube     = abrirYoutube;

  // Escuta o modo de operação em tempo real
  const docConfig = doc(db, "config", "app");
  onSnapshot(docConfig, (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();

    // Atualiza modo
    _modoAtual = data.modo || "estendida";
    _atualizarUIpelomodo(_modoAtual);

    // Sincroniza o slider com o volume salvo
    const vol = data.volume !== undefined ? data.volume : 100;
    const slider = document.getElementById("volume-slider");
    const label  = document.getElementById("volume-valor");
    if (slider) slider.value = vol;
    if (label)  label.textContent = `${vol}%`;
  });

  _escutarRoteiro();
}

// Atualiza o botão "Abrir Projetor" conforme o modo
function _atualizarUIpelomodo(modo) {
  const btn = document.getElementById("btn-projetor");
  if (!btn) return;

  if (modo === "remoto") {
    // No modo remoto o botão de projetor não faz sentido — esconde
    btn.style.display = "none";
  } else {
    btn.style.display = "";
    btn.textContent   = "📽️  Abrir Projetor";
  }
}

// ---------------------------------------------------------------------------
// Escuta em tempo real o roteiro no Firestore
// ---------------------------------------------------------------------------
function _escutarRoteiro() {
  const listEl    = document.getElementById("roteiro-list");
  const countEl   = document.getElementById("item-count");
  const nowPlayEl = document.getElementById("now-playing-title");
  const statusDot = document.getElementById("firebase-status-dot");
  const statusLbl = document.getElementById("firebase-status-label");

  onSnapshot(
    roteiroQuery,
    (snapshot) => {
      statusDot.classList.add("online");
      statusLbl.textContent = "Firebase Conectado";

      const itens = [];
      snapshot.forEach((d) => itens.push({ id: d.id, ...d.data() }));

      countEl.textContent = `${itens.length} item${itens.length !== 1 ? "s" : ""}`;

      const tocando = itens.find((i) => i.status === "tocando");
      if (tocando) {
        nowPlayEl.classList.remove("now-playing-idle");
        nowPlayEl.textContent = tocando.titulo;
      } else {
        nowPlayEl.classList.add("now-playing-idle");
        nowPlayEl.textContent = "Nenhum item ativo";
      }

      _renderizarLista(listEl, itens);
    },
    (error) => {
      console.error("Firestore error:", error);
      statusDot.classList.remove("online");
      statusLbl.textContent = "Erro de conexão";
      showToast("Erro ao conectar ao Firebase.", "error");
    }
  );
}

// ---------------------------------------------------------------------------
// Renderiza os cards do roteiro
// ---------------------------------------------------------------------------
function _renderizarLista(container, itens) {
  container.innerHTML = "";

  if (itens.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🎚️</div>
        <div class="empty-title">Roteiro Vazio</div>
        <div class="empty-sub">Adicione itens usando o painel lateral.</div>
      </div>`;
    return;
  }

  itens.forEach((item, index) => {
    const card = document.createElement("div");
    card.className = `roteiro-item ${item.status !== "parado" ? item.status : ""}`;
    card.dataset.tipo = item.tipo;
    card.dataset.id   = item.id;

    const badgeClass = {
      youtube: "badge-youtube",
      audio:   "badge-audio",
      video:   "badge-video",
    }[item.tipo] || "";

    const badgeLabel = {
      youtube: "▶ YouTube",
      audio:   "♪ Áudio",
      video:   "◼ Vídeo",
    }[item.tipo] || item.tipo;

    const statusLabel = {
      parado:    "Parado",
      preparado: "Preparado na tela",
      tocando:   "Tocando ao vivo",
    }[item.status] || item.status;

    const isTocando   = item.status === "tocando";
    const isPreparado = item.status === "preparado";

    card.innerHTML = `
      <div class="item-ordem">${index + 1}</div>

      <div class="item-info">
        <div class="item-titulo">${_escapeHtml(item.titulo)}</div>
        <div class="item-meta">
          <span class="item-badge ${badgeClass}">${badgeLabel}</span>
          <span class="item-status-text">${statusLabel}</span>
        </div>
        <div class="live-badge"><span class="live-dot"></span> AO VIVO</div>
      </div>

      <div class="item-actions">
        <button
          class="btn btn-sm ${isPreparado || isTocando ? 'btn-amber' : ''}"
          onclick="prepararItem('${item.id}')"
          ${isPreparado ? 'disabled title="Já preparado"' : ''}
        >
          📺 Preparar
        </button>

        <button
          class="btn btn-sm ${isTocando ? 'btn-danger' : 'btn-green'}"
          onclick="togglePlay('${item.id}', '${item.status}')"
        >
          ${isTocando ? "⏸ Pausar" : "▶ Play"}
        </button>

        <button
          class="btn btn-xs"
          style="color:var(--red); border-color:var(--red);"
          onclick="removerItem('${item.id}')"
        >
          🗑
        </button>
      </div>`;

    container.appendChild(card);
  });

  window.prepararItem = prepararItem;
  window.togglePlay   = togglePlay;
  window.removerItem  = removerItem;
}

// ---------------------------------------------------------------------------
// Ações de controle de itens
// ---------------------------------------------------------------------------

async function prepararItem(itemId) {
  try {
    await _pararTodosExceto(itemId);
    await updateDoc(doc(db, COLECAO_ROTEIRO, itemId), { status: "preparado" });
    showToast("Item preparado na tela do projetor.", "info");
  } catch (e) {
    console.error(e);
    showToast("Erro ao preparar item.", "error");
  }
}

async function togglePlay(itemId, statusAtual) {
  try {
    if (statusAtual === "tocando") {
      // Pausar — igual em todos os modos
      await updateDoc(doc(db, COLECAO_ROTEIRO, itemId), { status: "preparado" });
      showToast("Pausado.", "info");

    } else {
      // Play — comportamento depende do modo
      await _pararTodosExceto(itemId);

      if (_modoAtual === "remoto") {
        // Modo Remoto: só envia o comando, não abre janela nenhuma
        await updateDoc(doc(db, COLECAO_ROTEIRO, itemId), { status: "tocando" });
        showToast("▶ Reproduzindo! (Modo Remoto)", "success");

      } else if (_modoAtual === "duplicada") {
        // Modo Duplicada: abre a janela PRIMEIRO, aguarda carregar, depois dá play
        if (!_janelaProjecao || _janelaProjecao.closed) {
          // Abre a janela
          abrirProjecao();
          showToast("▶ Abrindo projetor…", "success");
          // Aguarda 3 segundos para a janela e o YouTube carregarem
          setTimeout(async () => {
            await updateDoc(doc(db, COLECAO_ROTEIRO, itemId), { status: "tocando" });
          }, 3000);
        } else {
          // Janela já aberta — dá play direto
          await updateDoc(doc(db, COLECAO_ROTEIRO, itemId), { status: "tocando" });
          showToast("▶ Reproduzindo!", "success");
        }

      } else {
        // Modo Estendida: só envia o comando
        await updateDoc(doc(db, COLECAO_ROTEIRO, itemId), { status: "tocando" });
        showToast("▶ Reproduzindo!", "success");
      }
    }
  } catch (e) {
    console.error(e);
    showToast("Erro ao controlar reprodução.", "error");
  }
}

async function removerItem(itemId) {
  if (!confirm("Remover este item do roteiro?")) return;
  try {
    const { deleteDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
    await deleteDoc(doc(db, COLECAO_ROTEIRO, itemId));
    showToast("Item removido.", "info");
  } catch (e) {
    console.error(e);
    showToast("Erro ao remover item.", "error");
  }
}

async function pararTudo() {
  try {
    const snapshot = await getDocs(roteiroQuery);
    const batch    = writeBatch(db);
    snapshot.forEach((d) => {
      if (d.data().status !== "parado") {
        batch.update(doc(db, COLECAO_ROTEIRO, d.id), { status: "parado" });
      }
    });
    await batch.commit();
    showToast("Tela do projetor limpa (tela preta).", "info");
  } catch (e) {
    console.error(e);
    showToast("Erro ao parar tudo.", "error");
  }
}

// ---------------------------------------------------------------------------
// Cola o link da área de transferência no campo de URL do YouTube
// ---------------------------------------------------------------------------
async function colarLink() {
  try {
    const texto = await navigator.clipboard.readText();
    const campo = document.getElementById("yt-url");
    if (campo) {
      campo.value = texto;
      showToast("Link colado!", "success");
    }
  } catch (e) {
    showToast("Permita o acesso à área de transferência.", "error");
  }
}

// ---------------------------------------------------------------------------
// Abre o YouTube no navegador (sem popup bloqueado)
// ---------------------------------------------------------------------------
function abrirYoutube() {
  window.location.href = "https://www.youtube.com";
}

// ---------------------------------------------------------------------------
async function atualizarVolume(valor) {
  // Atualiza o label visualmente em tempo real
  const label = document.getElementById("volume-valor");
  if (label) label.textContent = `${valor}%`;

  // Salva no Firestore (debounce de 300ms para não salvar a cada pixel)
  clearTimeout(atualizarVolume._timer);
  atualizarVolume._timer = setTimeout(async () => {
    try {
      await setDoc(
        doc(db, "config", "app"),
        { volume: parseInt(valor) },
        { merge: true }
      );
    } catch (e) {
      console.error("Erro ao salvar volume:", e);
    }
  }, 300);
}

async function _pararTodosExceto(exceptId) {
  const snapshot = await getDocs(roteiroQuery);
  const batch    = writeBatch(db);
  snapshot.forEach((d) => {
    if (d.id !== exceptId && d.data().status !== "parado") {
      batch.update(doc(db, COLECAO_ROTEIRO, d.id), { status: "parado" });
    }
  });
  await batch.commit();
}

// ---------------------------------------------------------------------------
// Adicionar item do YouTube
// ---------------------------------------------------------------------------
async function adicionarYoutube() {
  const titulo = document.getElementById("yt-titulo").value.trim();
  const url    = document.getElementById("yt-url").value.trim();

  if (!titulo || !url) {
    showToast("Preencha o título e a URL do YouTube.", "error");
    return;
  }

  if (!url.includes("youtube.com") && !url.includes("youtu.be")) {
    showToast("URL inválida. Use um link do YouTube.", "error");
    return;
  }

  try {
    const snapshot  = await getDocs(roteiroQuery);
    const proxOrdem = snapshot.size;

    await addDoc(collection(db, COLECAO_ROTEIRO), {
      titulo,
      tipo:     "youtube",
      url,
      status:   "parado",
      ordem:    proxOrdem,
      criadoEm: serverTimestamp(),
    });

    document.getElementById("yt-titulo").value = "";
    document.getElementById("yt-url").value    = "";
    showToast(`"${titulo}" adicionado ao roteiro!`, "success");
  } catch (e) {
    console.error(e);
    showToast("Erro ao adicionar item.", "error");
  }
}

// Referência à janela do projetor
let _janelaProjecao = null;

function abrirProjecao() {
  if (_janelaProjecao && !_janelaProjecao.closed) {
    _janelaProjecao.focus();
    return;
  }
  _janelaProjecao = window.open(
    "projecao.html",
    "ProjecaoSonoplastia",
    "toolbar=no,location=no,status=no,menubar=no"
  );
}

// =============================================================================
//   MÓDULO: TELA DE PROJEÇÃO (projecao.html)
// =============================================================================

function iniciarProjecao() {
  let ytPlayer    = null;
  let ytReady     = false;
  let ytUrlAtual  = null;
  let itemAtualId = null;

  const tag = document.createElement("script");
  tag.src   = "https://www.youtube.com/iframe_api";
  document.head.appendChild(tag);

  window.onYouTubeIframeAPIReady = () => {
    ytPlayer = new YT.Player("youtube-player", {
      width:  "100%",
      height: "100%",
      playerVars: {
        autoplay:       1,
        controls:       0,
        modestbranding: 1,
        rel:            0,
        iv_load_policy: 3,
        fs:             0,
        enablejsapi:    1,
        origin:         window.location.origin,
      },
      events: {
        onReady: () => { ytReady = true; },
      },
    });
  };

  // -----------------------------------------------------------------------
  // Escuta o volume do Firestore e aplica nos players
  // -----------------------------------------------------------------------
  const docConfigProjecao = doc(db, "config", "app");
  onSnapshot(docConfigProjecao, (snap) => {
    if (!snap.exists()) return;
    const vol = snap.data().volume !== undefined ? snap.data().volume / 100 : 1;

    // Aplica no YouTube
    if (ytReady && ytPlayer && ytPlayer.setVolume) {
      ytPlayer.setVolume(vol * 100);
    }

    // Aplica no áudio
    const audioEl = document.getElementById("audio-player");
    if (audioEl) audioEl.volume = vol;

    // Aplica no vídeo
    const videoEl = document.getElementById("video-player");
    if (videoEl) videoEl.volume = vol;
  });

  // -----------------------------------------------------------------------
  // Escuta o roteiro no Firestore
  // -----------------------------------------------------------------------
  onSnapshot(roteiroQuery, (snapshot) => {
    let itemAtivo = null;
    snapshot.forEach((d) => {
      const data = d.data();
      if (data.status === "tocando" || data.status === "preparado") {
        itemAtivo = { id: d.id, ...data };
      }
    });

    if (!itemAtivo) {
      _limparTela(ytPlayer, ytReady);
      itemAtualId = null;
      return;
    }

    const { id, tipo, url, status } = itemAtivo;
    const mudouItem = id !== itemAtualId;
    itemAtualId = id;

    if (tipo === "youtube") {
      _controlarYoutube({ ytPlayer, ytReady, url, status, mudouItem, ytUrlAtual,
        setYtUrl: (u) => { ytUrlAtual = u; } });
    } else if (tipo === "audio") {
      _controlarAudio({ url, status, mudouItem });
    } else if (tipo === "video") {
      _controlarVideo({ url, status, mudouItem });
    }
  });
}

// ---------------------------------------------------------------------------
// Controle YouTube na Projeção
// ---------------------------------------------------------------------------
function _controlarYoutube({ ytPlayer, ytReady, url, status, mudouItem, ytUrlAtual, setYtUrl }) {
  _mostrarPlayer("youtube");

  const videoId = _extrairVideoId(url);
  if (!videoId) return;

  const tentarControle = () => {
    if (!ytReady || !ytPlayer) { setTimeout(tentarControle, 300); return; }

    if (mudouItem || ytUrlAtual !== url) {
      setYtUrl(url);
      ytPlayer.loadVideoById(videoId);
      if (status === "preparado") ytPlayer.pauseVideo();
    } else {
      if (status === "tocando") {
        ytPlayer.playVideo();
      } else {
        ytPlayer.pauseVideo();
      }
    }
  };
  tentarControle();
}

// ---------------------------------------------------------------------------
// Controle Áudio na Projeção
// ---------------------------------------------------------------------------
function _controlarAudio({ url, status, mudouItem }) {
  _mostrarPlayer("audio");

  const audioEl   = document.getElementById("audio-player");
  const audioWrap = document.getElementById("audio-wrapper");

  if (mudouItem || (url && audioEl.src !== url)) {
    audioEl.src = url;
    audioEl.load();
  }

  if (status === "tocando") {
    const playPromise = audioEl.play();
    if (playPromise !== undefined) {
      playPromise.catch(() => {
        const desbloquear = () => {
          audioEl.play();
          document.removeEventListener("click", desbloquear);
        };
        document.addEventListener("click", desbloquear);
      });
    }
    audioWrap.classList.add("audio-playing");
  } else {
    audioEl.pause();
    audioWrap.classList.remove("audio-playing");
  }
}

// ---------------------------------------------------------------------------
// Controle Vídeo na Projeção
// ---------------------------------------------------------------------------
function _controlarVideo({ url, status, mudouItem }) {
  _mostrarPlayer("video");

  const videoEl = document.getElementById("video-player");

  if (mudouItem || (url && videoEl.src !== url)) {
    videoEl.src = url;
    videoEl.load();
  }

  if (status === "tocando") {
    const playPromise = videoEl.play();
    if (playPromise !== undefined) {
      playPromise.catch(() => {
        const desbloquear = () => {
          videoEl.play();
          document.removeEventListener("click", desbloquear);
        };
        document.addEventListener("click", desbloquear);
      });
    }
  } else {
    videoEl.pause();
  }
}

// ---------------------------------------------------------------------------
// Exibe apenas o player correto
// ---------------------------------------------------------------------------
function _mostrarPlayer(tipo) {
  document.getElementById("youtube-wrapper").style.display = tipo === "youtube" ? "block" : "none";
  document.getElementById("audio-wrapper").style.display   = tipo === "audio"   ? "flex"  : "none";
  document.getElementById("video-wrapper").style.display   = tipo === "video"   ? "block" : "none";
}

// ---------------------------------------------------------------------------
// Limpa tudo — tela preta
// ---------------------------------------------------------------------------
function _limparTela(ytPlayer, ytReady) {
  if (ytReady && ytPlayer) {
    try { ytPlayer.stopVideo(); } catch (_) {}
  }

  const audioEl = document.getElementById("audio-player");
  if (audioEl) { audioEl.pause(); audioEl.src = ""; }

  const videoEl = document.getElementById("video-player");
  if (videoEl) { videoEl.pause(); videoEl.src = ""; }

  document.getElementById("youtube-wrapper").style.display = "none";
  document.getElementById("audio-wrapper").style.display   = "none";
  document.getElementById("video-wrapper").style.display   = "none";
}

// =============================================================================
// UTILITÁRIOS
// =============================================================================

function _extrairVideoId(url) {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") return u.pathname.slice(1);
    return u.searchParams.get("v") || u.pathname.split("/").pop();
  } catch (_) {
    return null;
  }
}

function _escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------------------------------------------------------------------------
// Toast / Notificações
// ---------------------------------------------------------------------------
window.showToast = function (mensagem, tipo = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const icons = { success: "✅", error: "❌", info: "ℹ️" };

  const toast     = document.createElement("div");
  toast.className = `toast ${tipo}`;
  toast.innerHTML = `<span>${icons[tipo] || "•"}</span><span>${mensagem}</span>`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity    = "0";
    toast.style.transition = "opacity 0.3s";
    setTimeout(() => toast.remove(), 320);
  }, 4000);
};
