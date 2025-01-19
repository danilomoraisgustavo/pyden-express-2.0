// -----------------------------------------------------
// VARIÁVEIS GLOBAIS
// -----------------------------------------------------
let currentNotifications = []; // Armazena a lista de notificações atuais

// -----------------------------------------------------
// FUNÇÃO: Buscar notificações do servidor
// -----------------------------------------------------
function fetchNotifications() {
  fetch("/api/notificacoes")
    .then((res) => res.json())
    .then((data) => {
      if (!data || !data.success) {
        console.warn("Sem notificações ou erro:", data?.message);
        return;
      }

      const notifListEl = document.getElementById("notifList");
      const notifCountEl = document.getElementById("notifCount");
      const notifTitleEl = document.getElementById("notifTitle");

      // Limpa HTML anterior
      notifListEl.innerHTML = "";

      // Guarda as notificações numa variável global
      const notifications = data.notifications || [];
      currentNotifications = notifications;

      // Se estiver retornando TUDO (lidas + não lidas), filtre as não lidas:
      // const unreadCount = notifications.filter((n) => !n.is_read).length;
      // Se estiver retornando SÓ as não lidas do backend, use:
      const unreadCount = notifications.length;

      if (unreadCount === 0) {
        notifTitleEl.textContent = "Você não tem novas notificações";
        notifCountEl.textContent = "0";
        // Opcional: esconder o badge se for 0
        notifCountEl.style.display = "none";
      } else {
        notifTitleEl.textContent = `Você tem ${unreadCount} novas notificações`;
        notifCountEl.textContent = unreadCount;
        notifCountEl.style.display = "inline-block";
      }

      // Preenche cada notificação no dropdown
      notifications.forEach((item) => {
        const a = document.createElement("a");
        a.href = "#";

        // Exemplo: se quisesse marcar individualmente ao clicar
        // a.addEventListener("click", (e) => {
        //   e.preventDefault();
        //   marcarNotificacoesComoLidas([item.id]);
        // });

        // Se a notificação já estiver lida, podemos usar um estilo diferente
        const isReadClass = item.is_read ? "text-muted" : "fw-bold";

        a.innerHTML = `
          <div class="notif-icon notif-primary">
            <i class="fa fa-info-circle"></i>
          </div>
          <div class="notif-content ${isReadClass}">
            <span class="block">${item.mensagem}</span>
            <span class="time">${item.tempo}</span>
          </div>
        `;
        notifListEl.appendChild(a);
      });
    })
    .catch((err) => {
      console.error("Erro ao buscar notificacoes:", err);
    });
}

// -----------------------------------------------------
// FUNÇÃO: Marcar notificações como lidas (PATCH no servidor)
// -----------------------------------------------------
async function marcarNotificacoesComoLidas(notificacaoIds) {
  try {
    const response = await fetch("/api/notificacoes/marcar-lido", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ notificacaoIds }),
    });
    const data = await response.json();
    if (data.success) {
      console.log("Notificações marcadas como lidas");
      // Após marcar como lidas no servidor, recarregamos a lista no front
      fetchNotifications();
    } else {
      console.error("Falha ao marcar notificações:", data.message);
    }
  } catch (error) {
    console.error("Erro:", error);
  }
}

// -----------------------------------------------------
// EVENTOS DOMContentLoaded
// -----------------------------------------------------
document.addEventListener("DOMContentLoaded", function () {
  // 1) Buscar info do usuário da sessão
  fetch("/api/usuario-logado")
    .then((res) => res.json())
    .then((data) => {
      if (data && data.success) {
        document.getElementById("dropdownUserName").textContent =
          data.nome_completo || "Usuário";
        document.getElementById("dropdownUserBoxName").textContent =
          data.nome_completo || "Usuário";
        document.getElementById("dropdownUserEmail").textContent =
          data.email || "email@exemplo.com";
      } else {
        console.warn("Não logado ou erro:", data?.message);
      }
    })
    .catch((err) => {
      console.error("Erro ao buscar /api/usuario-logado:", err);
    });

  // 2) Vincular Logout
  const logoutLink = document.getElementById("logoutLink");
  if (logoutLink) {
    logoutLink.addEventListener("click", function (e) {
      e.preventDefault();
      fetch("/logout", { method: "GET" })
        .then(() => {
          window.location.href = "/";
        })
        .catch((err) => {
          console.error("Erro ao fazer logout:", err);
          window.location.href = "/";
        });
    });
  }

  // 3) Buscar notificações logo ao carregar a página
  fetchNotifications();

  // 4) Link "Ver todas" notificações (exemplo)
  const notifSeeAll = document.getElementById("notifSeeAll");
  if (notifSeeAll) {
    notifSeeAll.addEventListener("click", function (e) {
      e.preventDefault();
      console.log("Clique em 'Ver todas as notificações'");
      // window.location.href = "/pages/notificacoes/listar.html"; // Exemplo
    });
  }

  // 5) Botão "Marcar todas como lidas" (opcional)
  const notifMarkAllRead = document.getElementById("notifMarkAllRead");
  if (notifMarkAllRead) {
    notifMarkAllRead.addEventListener("click", function (e) {
      e.preventDefault();
      // Pega todos os IDs das notificações atuais
      const allIds = currentNotifications.map((n) => n.id);
      if (allIds.length > 0) {
        marcarNotificacoesComoLidas(allIds);
      }
    });
  }

  // 6) Marcar como lidas AO ABRIR O DROPDOWN (Bootstrap 5 -> "show.bs.dropdown")
  const notifDropdownLink = document.getElementById("notifDropdown");
  if (notifDropdownLink) {
    notifDropdownLink.addEventListener("show.bs.dropdown", function () {
      // Coleta todos IDs das notificações atuais
      const allIds = currentNotifications.map((n) => n.id);
      if (allIds.length > 0) {
        marcarNotificacoesComoLidas(allIds);
      }
    });
  }
});
