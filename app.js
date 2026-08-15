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
  getDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  writeBatch,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// =============================================================================
// CONSTANTES E SALA
// =============================================================================

// Lê o código da sala salvo no login
const _codigoSala = localStorage.getItem("sonoplastia_sala") || "default";

// Prefixo das coleções — tudo isolado por sala
const COLECAO_ROTEIRO   = `salas/${_codigoSala}/roteiro`;
const COLECAO_FAVORITOS = `salas/${_codigoSala}/favoritos`;
const COLECAO_CONFIG    = `salas/${_codigoSala}/config`;

// ⚠️ Substitua pelo valor da sua chave da YouTube Data API v3
const YOUTUBE_API_KEY = "COLE_SUA_CHAVE_AQUI";

/** Bloqueia re-renderização durante drag-and-drop */
let _arrastando = false;
let _favoritosIds   = new Set();
let _favoritosCache = [];

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
  window.abrirProjecao          = abrirProjecao;
  window.pararTudo              = pararTudo;
  window.adicionarYoutube       = adicionarYoutube;
  window.atualizarVolume        = atualizarVolume;
  window.colarLink              = colarLink;
  window.abrirYoutube           = abrirYoutube;
  window.toggleFavoritos        = toggleFavoritos;
  window.adicionarFavAoRoteiro  = adicionarFavAoRoteiro;
  window.removerFavorito        = removerFavorito;

  // Escuta o modo de operação em tempo real
  const docConfig = doc(db, COLECAO_CONFIG, "app");
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

  // Escuta favoritos em tempo real para colorir estrelas e renderizar painel
  onSnapshot(collection(db, COLECAO_FAVORITOS), (snap) => {
    _favoritosIds = new Set();
    _favoritosCache = [];
    snap.forEach((d) => {
      _favoritosIds.add(d.id);
      _favoritosCache.push({ id: d.id, ...d.data() });
    });

    // Atualiza contador no botão
    const badge = document.getElementById("favoritos-count");
    if (badge) {
      badge.textContent = _favoritosCache.length;
      badge.classList.toggle("visivel", _favoritosCache.length > 0);
    }

    // Re-renderiza painel de favoritos se estiver aberto
    _renderizarFavoritos();

    // Re-renderiza lista para atualizar estrelas
    const listEl = document.getElementById("roteiro-list");
    if (listEl && listEl._itensCache) {
      _renderizarLista(listEl, listEl._itensCache);
    }
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

      // Não re-renderiza durante drag-and-drop
      if (_arrastando) return;

      _renderizarLista(listEl, itens);
      listEl._itensCache = itens;
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

    const isFavorito  = _favoritosIds.has(item.id);
    const isTocando   = item.status === "tocando";
    const isPreparado = item.status === "preparado";

    card.innerHTML = `
      <div class="item-ordem">${index + 1}</div>

      <div class="item-info">
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
          <button
            class="btn btn-xs"
            title="${isFavorito ? 'Remover dos favoritos' : 'Salvar nos favoritos'}"
            style="color:${isFavorito ? 'var(--amber)' : 'var(--text-dim)'}; border-color:${isFavorito ? 'var(--amber)' : 'var(--border)'}; padding:2px 8px; font-size:12px;"
            onclick="salvarFavorito('${item.id}')"
          >${isFavorito ? '★' : '☆'}</button>
          <div class="item-titulo">${_escapeHtml(item.titulo)}</div>
        </div>
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

  window.prepararItem   = prepararItem;
  window.togglePlay     = togglePlay;
  window.removerItem    = removerItem;
  window.salvarFavorito = salvarFavorito;

  // Inicializa o drag-and-drop após renderizar
  _inicializarSortable(container, itens);
}

// ---------------------------------------------------------------------------
// Inicializa o Sortable na lista do roteiro
// ---------------------------------------------------------------------------
function _inicializarSortable(container, itens) {
  // Destrói instância anterior se existir
  if (container._sortable) container._sortable.destroy();

  if (typeof Sortable === "undefined") return;

  container._sortable = new Sortable(container, {
    animation:        200,
    ghostClass:       "sortable-ghost",
    chosenClass:      "sortable-chosen",
    delay:            150,
    delayOnTouchOnly: true,

    onStart: () => {
      _arrastando = true;  // pausa o onSnapshot
    },

    onEnd: async (evt) => {
      // Recalcula a nova ordem baseada na posição dos cards
      const cards = [...container.querySelectorAll(".roteiro-item")];
      const batch  = writeBatch(db);

      cards.forEach((card, novaOrdem) => {
        const id = card.dataset.id;
        if (id) {
          batch.update(doc(db, COLECAO_ROTEIRO, id), { ordem: novaOrdem });
        }
      });

      try {
        await batch.commit();
        showToast("Ordem atualizada!", "success");
      } catch (e) {
        console.error(e);
        showToast("Erro ao salvar nova ordem.", "error");
      } finally {
        // Retoma re-renderização após salvar
        setTimeout(() => { _arrastando = false; }, 500);
      }
    },
  });
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
    await deleteDoc(doc(db, COLECAO_ROTEIRO, itemId));
    showToast("Item removido.", "info");
  } catch (e) {
    console.error(e);
    showToast("Erro ao remover item.", "error");
  }
}

// ---------------------------------------------------------------------------
// Painel flutuante de favoritos
// ---------------------------------------------------------------------------
function toggleFavoritos() {
  const painel = document.getElementById("favoritos-painel");
  if (!painel) return;
  painel.classList.toggle("aberto");
  _renderizarFavoritos();
}

function _renderizarFavoritos() {
  const lista = document.getElementById("favoritos-lista");
  if (!lista) return;

  if (_favoritosCache.length === 0) {
    lista.innerHTML = `<span class="favoritos-vazio">Nenhum favorito salvo ainda. Clique em ☆ em um item do roteiro.</span>`;
    return;
  }

  lista.innerHTML = _favoritosCache.map(fav => `
    <div class="favorito-chip">
      <span class="favorito-chip-nome">★ ${_escapeHtml(fav.titulo)}</span>
      <button class="favorito-chip-add" onclick="adicionarFavAoRoteiro('${fav.id}')">
        + Roteiro
      </button>
      <button class="favorito-chip-rem" onclick="removerFavorito('${fav.id}')" title="Remover dos favoritos">
        ×
      </button>
    </div>
  `).join("");
}

async function adicionarFavAoRoteiro(favId) {
  try {
    const fav = _favoritosCache.find(f => f.id === favId);
    if (!fav) return;

    const snapshot  = await getDocs(roteiroQuery);
    const proxOrdem = snapshot.size;

    await addDoc(collection(db, COLECAO_ROTEIRO), {
      titulo:    fav.titulo,
      tipo:      fav.tipo,
      url:       fav.url,
      status:    "parado",
      ordem:     proxOrdem,
      criadoEm:  serverTimestamp(),
    });

    showToast(`"${fav.titulo}" adicionado ao roteiro!`, "success");

    // Fecha o painel após adicionar
    const painel = document.getElementById("favoritos-painel");
    if (painel) painel.classList.remove("aberto");

  } catch (e) {
    console.error(e);
    showToast("Erro ao adicionar favorito ao roteiro.", "error");
  }
}

// ---------------------------------------------------------------------------
// Salvar / Remover dos favoritos (toggle)
// ---------------------------------------------------------------------------
async function salvarFavorito(itemId) {
  try {
    const favRef = doc(db, COLECAO_FAVORITOS, itemId);

    if (_favoritosIds.has(itemId)) {
      // Já é favorito → remove
      await deleteDoc(favRef);
      showToast("Removido dos favoritos.", "info");
    } else {
      // Não é favorito → busca os dados do item e salva
      const itemSnap = await getDoc(doc(db, COLECAO_ROTEIRO, itemId));
      if (!itemSnap.exists()) return;
      const { titulo, tipo, url } = itemSnap.data();

      await setDoc(favRef, {
        titulo,
        tipo,
        url,
        savedAt: serverTimestamp(),
      });
      showToast(`"${titulo}" salvo nos favoritos! ★`, "success");
    }
  } catch (e) {
    console.error(e);
    showToast("Erro ao atualizar favoritos.", "error");
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
// Cola o link e busca o título automaticamente via YouTube Data API
// ---------------------------------------------------------------------------
async function colarLink() {
  try {
    const texto = await navigator.clipboard.readText();
    const campoUrl    = document.getElementById("yt-url");
    const campoTitulo = document.getElementById("yt-titulo");
    if (!campoUrl) return;

    campoUrl.value = texto;
    showToast("Link colado! Buscando título…", "info");

    // Extrai o ID do vídeo e busca o título
    const videoId = _extrairVideoId(texto);
    if (videoId && YOUTUBE_API_KEY !== "COLE_SUA_CHAVE_AQUI") {
      const titulo = await _buscarTituloYoutube(videoId);
      if (titulo && campoTitulo && !campoTitulo.value) {
        campoTitulo.value = titulo;
        showToast(`Título encontrado: "${titulo}"`, "success");
      }
    }
  } catch (e) {
    showToast("Permita o acesso à área de transferência.", "error");
  }
}

// Busca o título do vídeo na YouTube Data API
async function _buscarTituloYoutube(videoId) {
  try {
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${YOUTUBE_API_KEY}`;
    const resp = await fetch(url);
    const data = await resp.json();
    if (data.items && data.items.length > 0) {
      return data.items[0].snippet.title;
    }
    return null;
  } catch (e) {
    console.error("Erro ao buscar título:", e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Abre o YouTube no navegador (sem popup bloqueado)
// ---------------------------------------------------------------------------
function abrirYoutube() {
  window.location.href = "https://www.youtube.com";
}

// ---------------------------------------------------------------------------
// Remover favorito diretamente do painel
// ---------------------------------------------------------------------------
async function removerFavorito(favId) {
  try {
    await deleteDoc(doc(db, COLECAO_FAVORITOS, favId));
    showToast("Removido dos favoritos.", "info");
  } catch (e) {
    console.error(e);
    showToast("Erro ao remover favorito.", "error");
  }
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
        doc(db, COLECAO_CONFIG, "app"),
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
  const docConfigProjecao = doc(db, COLECAO_CONFIG, "app");
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
