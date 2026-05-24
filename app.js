// =============================================================================
// app.js — Lógica Central do Sonoplastia App
//
// Este módulo detecta em qual tela está rodando (Painel ou Projeção)
// e inicializa o comportamento correto para cada uma.
//
// Dependências: firebase-config.js (Firestore + Storage)
// =============================================================================

import { db } from "./firebase-config.js";

import {
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
  writeBatch,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// =============================================================================
// CONSTANTES
// =============================================================================

/** Nome da coleção no Firestore */
const COLECAO_ROTEIRO = "roteiro";

/** Referência para a query ordenada */
const roteiroQuery = query(
  collection(db, COLECAO_ROTEIRO),
  orderBy("ordem", "asc")
);

// =============================================================================
// DETECÇÃO DE PÁGINA
// Verifica se estamos no Painel (index.html) ou na Projeção (projecao.html)
// =============================================================================

const isOperador = document.getElementById("roteiro-list") !== null;
const isProjecao = document.getElementById("projecao-container") !== null;

if (isOperador) iniciarOperador();
if (isProjecao)  iniciarProjecao();

// =============================================================================
// =============================================================================
//
//   MÓDULO: PAINEL DO OPERADOR (index.html)
//
// =============================================================================
// =============================================================================

function iniciarOperador() {

  // Expõe funções de ação para os botões HTML (onclick inline)
  window.abrirProjecao    = abrirProjecao;
  window.fecharProjecao   = fecharProjecao;
  window.pararTudo        = pararTudo;
  window.adicionarYoutube = adicionarYoutube;

  _escutarRoteiro();
}

// ---------------------------------------------------------------------------
// Escuta em tempo real o roteiro no Firestore e re-renderiza a lista
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
      // Conexão bem-sucedida
      statusDot.classList.add("online");
      statusLbl.textContent = "Firebase Conectado";

      const itens = [];
      snapshot.forEach((d) => itens.push({ id: d.id, ...d.data() }));

      countEl.textContent = `${itens.length} item${itens.length !== 1 ? "s" : ""}`;

      // Atualiza "Ao Vivo Agora"
      const tocando = itens.find((i) => i.status === "tocando");
      if (tocando) {
        nowPlayEl.classList.remove("now-playing-idle");
        nowPlayEl.textContent = tocando.titulo;
      } else {
        nowPlayEl.classList.add("now-playing-idle");
        nowPlayEl.textContent = "Nenhum item ativo";
      }

      // Renderiza a lista
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
        <div class="empty-sub">Adicione itens usando o painel lateral (YouTube ou upload de arquivo).</div>
      </div>`;
    return;
  }

  itens.forEach((item, index) => {
    const card = document.createElement("div");
    card.className = `roteiro-item ${item.status !== "parado" ? item.status : ""}`;
    card.dataset.tipo = item.tipo;
    card.dataset.id   = item.id;

    // Badge de tipo
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

    // Status legível
    const statusLabel = {
      parado:    "Parado",
      preparado: "Preparado na tela",
      tocando:   "Tocando ao vivo",
    }[item.status] || item.status;

    // Botões — lógica de estado
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

  // Expõe funções de controle para os botões inline do HTML gerado
  window.prepararItem = prepararItem;
  window.togglePlay   = togglePlay;
  window.removerItem  = removerItem;
}

// ---------------------------------------------------------------------------
// Ações de controle de itens
// ---------------------------------------------------------------------------

/**
 * Marca um item como "preparado" (carregado na projeção mas não tocando).
 * Garante que apenas UM item pode estar preparado/tocando por vez.
 */
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

/**
 * Alterna entre Play e Pause de um item.
 * Se outro item estava tocando, ele é parado primeiro.
 */
async function togglePlay(itemId, statusAtual) {
  try {
    if (statusAtual === "tocando") {
      // Pausar: volta para "preparado"
      await updateDoc(doc(db, COLECAO_ROTEIRO, itemId), { status: "preparado" });
      showToast("Pausado.", "info");
    } else {
      // Tocar: para todos, depois dá play neste
      await _pararTodosExceto(itemId);
      await updateDoc(doc(db, COLECAO_ROTEIRO, itemId), { status: "tocando" });

      // Abre o projetor automaticamente se estiver fechado
      if (!_janelaProjecao || _janelaProjecao.closed) {
        // Aguarda 2 segundos antes de tocar (tempo para a janela carregar)
        setTimeout(() => {
          abrirProjecao();
        }, 0);
        showToast("Abrindo projetor e reproduzindo em 2 segundos…", "success");
      } else {
        showToast("Reproduzindo!", "success");
      }
    }
  } catch (e) {
    console.error(e);
    showToast("Erro ao controlar reprodução.", "error");
  }
}

/**
 * Remove um item do roteiro.
 */
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

/**
 * Para todos os itens (coloca status "parado") — Tela Preta.
 */
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

/**
 * Para todos os itens EXCETO o informado (batch update).
 */
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
// Adicionar item do YouTube manualmente
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
    // Descobre o próximo número de ordem
    const snapshot = await getDocs(roteiroQuery);
    const proxOrdem = snapshot.size;

    await addDoc(collection(db, COLECAO_ROTEIRO), {
      titulo,
      tipo:   "youtube",
      url,
      status: "parado",
      ordem:  proxOrdem,
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

// ---------------------------------------------------------------------------
// Gerenciamento da janela do projetor
// ---------------------------------------------------------------------------

/** Referência à janela do projetor (null se fechada) */
let _janelaProjecao = null;

/**
 * Abre a tela de projeção em nova janela e entra em tela cheia.
 * Se já estiver aberta, apenas traz para frente.
 */
function abrirProjecao() {
  if (_janelaProjecao && !_janelaProjecao.closed) {
    _janelaProjecao.focus();
    showToast("Projetor já está aberto.", "info");
    return;
  }
  _janelaProjecao = window.open(
    "projecao.html",
    "ProjecaoSonoplastia",
    "toolbar=no,location=no,status=no,menubar=no"
  );
  // Atualiza botão do painel
  _atualizarBotaoProjetor(true);
  showToast("Projetor aberto!", "success");

  // Detecta se a janela foi fechada manualmente
  const checarFechamento = setInterval(() => {
    if (_janelaProjecao && _janelaProjecao.closed) {
      _janelaProjecao = null;
      _atualizarBotaoProjetor(false);
      clearInterval(checarFechamento);
    }
  }, 1000);
}

/**
 * Fecha a janela do projetor remotamente.
 */
function fecharProjecao() {
  if (_janelaProjecao && !_janelaProjecao.closed) {
    _janelaProjecao.close();
    _janelaProjecao = null;
  }
  _atualizarBotaoProjetor(false);
  showToast("Projetor fechado.", "info");
}

/**
 * Atualiza o botão de projetor na topbar conforme estado.
 */
function _atualizarBotaoProjetor(aberto) {
  const btn = document.getElementById("btn-projetor");
  if (!btn) return;
  if (aberto) {
    btn.textContent = "✖ Fechar Projetor";
    btn.onclick = fecharProjecao;
    btn.classList.remove("btn-accent");
    btn.classList.add("btn-danger");
  } else {
    btn.textContent = "📽️ Abrir Projetor";
    btn.onclick = abrirProjecao;
    btn.classList.remove("btn-danger");
    btn.classList.add("btn-accent");
  }
}

// =============================================================================
// =============================================================================
//
//   MÓDULO: TELA DE PROJEÇÃO (projecao.html)
//
// =============================================================================
// =============================================================================

function iniciarProjecao() {
  let ytPlayer       = null;
  let ytReady        = false;
  let ytUrlAtual     = null;
  let itemAtualId    = null;

  // -----------------------------------------------------------------------
  // Entra em tela cheia automaticamente após 2 segundos
  // (aguarda interação do usuário para o navegador permitir)
  // -----------------------------------------------------------------------
  const entrarTelaCheia = () => {
    const el = document.documentElement;
    if (el.requestFullscreen)            el.requestFullscreen();
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    else if (el.mozRequestFullScreen)    el.mozRequestFullScreen();
  };

  // Tenta entrar em tela cheia assim que a página carrega
  // O navegador pode bloquear sem interação — tentamos ao primeiro clique também
  setTimeout(entrarTelaCheia, 500);
  document.addEventListener("click", entrarTelaCheia, { once: true });

  // -----------------------------------------------------------------------
  // Botão flutuante de fechar (some após 4s sem mover o mouse)
  // -----------------------------------------------------------------------
  const btnFechar = document.getElementById("btn-fechar-projecao");
  let timerBtnFechar = null;

  const mostrarBtnFechar = () => {
    if (!btnFechar) return;
    btnFechar.classList.add("visivel");
    clearTimeout(timerBtnFechar);
    timerBtnFechar = setTimeout(() => {
      btnFechar.classList.remove("visivel");
    }, 4000);
  };

  document.addEventListener("mousemove", mostrarBtnFechar);
  document.addEventListener("touchstart", mostrarBtnFechar);

  if (btnFechar) {
    btnFechar.addEventListener("click", () => {
      // Sai da tela cheia antes de fechar
      if (document.exitFullscreen)            document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      window.close();
    });
  }

  // -----------------------------------------------------------------------
  // Carrega a YouTube IFrame API dinamicamente
  // -----------------------------------------------------------------------
  const tag = document.createElement("script");
  tag.src   = "https://www.youtube.com/iframe_api";
  document.head.appendChild(tag);

  // Callback global exigido pela API do YouTube
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
        // Detecta fim do vídeo
        onStateChange: (event) => {
          if (event.data === YT.PlayerState.ENDED) {
            _aoTerminarVideo();
          }
        },
      },
    });
  };

  // -----------------------------------------------------------------------
  // Escuta o Firestore em tempo real
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
// Chamado quando o vídeo do YouTube termina — volta para tela preta
// ---------------------------------------------------------------------------
async function _aoTerminarVideo() {
  try {
    // Para todos os itens → tela preta automaticamente
    const snapshot = await getDocs(roteiroQuery);
    const batch    = writeBatch(db);
    snapshot.forEach((d) => {
      if (d.data().status !== "parado") {
        batch.update(doc(db, COLECAO_ROTEIRO, d.id), { status: "parado" });
      }
    });
    await batch.commit();
  } catch (e) {
    console.error("Erro ao parar após fim do vídeo:", e);
  }
}

// ---------------------------------------------------------------------------
// Controle YouTube na Projeção
// ---------------------------------------------------------------------------
function _controlarYoutube({ ytPlayer, ytReady, url, status, mudouItem, ytUrlAtual, setYtUrl }) {
  _mostrarPlayer("youtube");

  const videoId = _extrairVideoId(url);
  if (!videoId) return;

  // Aguarda a API estar pronta
  const tentarControle = () => {
    if (!ytReady || !ytPlayer) { setTimeout(tentarControle, 300); return; }

    if (mudouItem || ytUrlAtual !== url) {
      // Carrega novo vídeo
      setYtUrl(url);
      ytPlayer.loadVideoById(videoId);
      if (status === "preparado") ytPlayer.pauseVideo(); // Carrega pausado
      // "tocando" — loadVideoById já começa a tocar automaticamente
    } else {
      // Mesmo vídeo, apenas alterna play/pause
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

  // Só recarrega se mudou o item ou a URL é diferente
  if (mudouItem || (url && audioEl.src !== url)) {
    audioEl.src = url;
    audioEl.load();
  }

  if (status === "tocando") {
    // Tenta dar play; se o navegador bloquear, aguarda interação
    const playPromise = audioEl.play();
    if (playPromise !== undefined) {
      playPromise.catch(() => {
        // Bloqueio de autoplay: aguarda um clique na tela do projetor
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
// Exibe apenas o player correto, esconde os demais
// ---------------------------------------------------------------------------
function _mostrarPlayer(tipo) {
  document.getElementById("youtube-wrapper").style.display = tipo === "youtube" ? "block"   : "none";
  document.getElementById("audio-wrapper").style.display   = tipo === "audio"   ? "flex"    : "none";
  document.getElementById("video-wrapper").style.display   = tipo === "video"   ? "block"   : "none";
}

// ---------------------------------------------------------------------------
// Limpa tudo — tela preta
// ---------------------------------------------------------------------------
function _limparTela(ytPlayer, ytReady) {
  // Pausa e limpa o YouTube
  if (ytReady && ytPlayer) {
    try { ytPlayer.stopVideo(); } catch (_) {}
  }

  // Para o áudio
  const audioEl = document.getElementById("audio-player");
  if (audioEl) { audioEl.pause(); audioEl.src = ""; }

  // Para o vídeo
  const videoEl = document.getElementById("video-player");
  if (videoEl) { videoEl.pause(); videoEl.src = ""; }

  // Esconde todos os wrappers
  document.getElementById("youtube-wrapper").style.display = "none";
  document.getElementById("audio-wrapper").style.display   = "none";
  document.getElementById("video-wrapper").style.display   = "none";
}

// =============================================================================
// UTILITÁRIOS COMPARTILHADOS
// =============================================================================

/**
 * Extrai o video ID de uma URL do YouTube.
 * Suporta: youtu.be/ID, youtube.com/watch?v=ID, youtube.com/embed/ID
 */
function _extrairVideoId(url) {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") return u.pathname.slice(1);
    return u.searchParams.get("v") || u.pathname.split("/").pop();
  } catch (_) {
    return null;
  }
}

/**
 * Escapa caracteres HTML para evitar XSS na renderização de strings.
 */
function _escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------------------------------------------------------------------------
// Sistema de Toast / Notificações (apenas no Painel do Operador)
// ---------------------------------------------------------------------------
window.showToast = function (mensagem, tipo = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const icons = { success: "✅", error: "❌", info: "ℹ️" };

  const toast    = document.createElement("div");
  toast.className = `toast ${tipo}`;
  toast.innerHTML = `<span>${icons[tipo] || "•"}</span><span>${mensagem}</span>`;

  container.appendChild(toast);

  // Remove após 4 segundos
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transition = "opacity 0.3s";
    setTimeout(() => toast.remove(), 320);
  }, 4000);
};
