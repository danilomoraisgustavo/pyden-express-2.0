/* --------------------  VARIÁVEIS  -------------------- */
let currentNotifications = [];
const notifListEl = document.getElementById("notifList");
const notifCountEl = document.getElementById("notifCount");
const notifTitleEl = document.getElementById("notifTitle");
const markAllBtn = document.getElementById("notifMarkAllRead");

/* --------------------  RENDERIZAÇÃO  -------------------- */
function renderCount() {
  const n = currentNotifications.length;
  if (!n) {
    notifTitleEl.textContent = "Você não tem novas notificações";
    notifCountEl.style.display = "none";
  } else {
    notifTitleEl.textContent = `Você tem ${n} novas notificações`;
    notifCountEl.textContent = n;
    notifCountEl.style.display = "inline-block";
  }
}

function buildItem(n) {
  const a = document.createElement("a");
  a.href = "#";
  a.className = "notif-item position-relative py-2 px-3";
  a.dataset.id = n.id;

  a.innerHTML = `
    <div class="notif-icon bg-primary text-white me-3">
      <i class="fa fa-info"></i>
    </div>
    <div class="notif-content">
      <span class="block">${n.mensagem}</span>
      <span class="time">${n.tempo}</span>
    </div>
    <button class="btn mark-single-read position-absolute end-0 top-50 translate-middle-y
                   text-success p-0 border-0 bg-transparent" title="Marcar como lida">
      <i class="fa fa-check-circle fs-5"></i>
    </button>`;
  return a;
}

/* --------------------  FETCH  -------------------- */
function fetchNotifications() {
  fetch("/api/notificacoes")
    .then(r => r.json())
    .then(d => {
      // pega só as não lidas e as 10 primeiras
      const unread = (d.notifications || [])
        .filter(n => !n.is_read)

      currentNotifications = unread;
      notifListEl.innerHTML = "";
      currentNotifications.forEach(n => notifListEl.appendChild(buildItem(n)));
      renderCount();
    })
    .catch(err => console.error("Erro ao buscar notificações:", err));
}


/* --------------------  PATCH  -------------------- */
async function marcarNotificacoesComoLidas(ids) {
  if (!ids.length) return false;
  const r = await fetch("/api/notificacoes/marcar-lido", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notificacaoIds: ids })
  });
  const d = await r.json();
  return d.success;
}

/* --------------------  EVENTOS  -------------------- */
notifListEl.addEventListener("click", e => {
  const btn = e.target.closest(".mark-single-read");
  if (!btn) return;
  e.preventDefault();          // não fecha dropdown
  e.stopPropagation();

  const item = btn.closest(".notif-item");
  const id = parseInt(item.dataset.id, 10);

  marcarNotificacoesComoLidas([id]).then(ok => {
    if (ok) {
      currentNotifications = currentNotifications.filter(n => n.id !== id);
      item.remove();
      renderCount();
    }
  });
});

markAllBtn.addEventListener("click", e => {
  e.preventDefault();
  if (!currentNotifications.length) return;
  const ids = currentNotifications.map(n => n.id);
  marcarNotificacoesComoLidas(ids).then(ok => {
    if (ok) {
      currentNotifications = [];
      notifListEl.innerHTML = "";
      renderCount();
    }
  });
});

/* --------------------  LOGIN / LOGOUT  -------------------- */
document.addEventListener("DOMContentLoaded", () => {
  fetch("/api/usuario-logado")
    .then(r => r.json())
    .then(d => {
      if (d && d.success) {
        document.getElementById("dropdownUserBoxName").textContent = d.nome_completo || "Usuário";
        document.getElementById("dropdownUserEmail").textContent = d.email || "email@exemplo.com";
      }
    });

  const logout = document.getElementById("logoutLink");
  if (logout) {
    logout.addEventListener("click", e => {
      e.preventDefault();
      fetch("/logout").finally(() => location.href = "/");
    });
  }

  fetchNotifications();
});
