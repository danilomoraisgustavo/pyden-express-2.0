
// Função para buscar notificações do servidor
function fetchNotifications() {
  fetch("/api/notificacoes")
    .then((res) => res.json())
    .then((data) => {
      if (!data || !data.success) {
        console.warn("Sem notificações ou erro:", data?.message);
        return;
      }

      // data.notifications deve ser um array de objetos, ex:
      // [ { mensagem: 'Nova escola cadastrada: ...', tempo: 'Há 2 min' }, ... ]
      const notifListEl = document.getElementById("notifList");
      const notifCountEl = document.getElementById("notifCount");
      const notifTitleEl = document.getElementById("notifTitle");

      notifListEl.innerHTML = "";
      const notifications = data.notifications || [];

      // Atualiza contagem
      notifCountEl.textContent = notifications.length;

      if (notifications.length === 0) {
        notifTitleEl.textContent = "Você não tem novas notificações";
      } else {
        notifTitleEl.textContent = `Você tem ${notifications.length} novas notificações`;
      }

      notifications.forEach((item) => {
        const a = document.createElement("a");
        a.href = "#"; // ou outro link, se quiser
        a.innerHTML = `
            <div class="notif-icon notif-primary">
              <i class="fa fa-info-circle"></i>
            </div>
            <div class="notif-content">
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

// Evento único do DOMContentLoaded
document.addEventListener("DOMContentLoaded", function () {
  // 1) Buscar info do usuário da sessão
  fetch("/api/usuario-logado")
    .then((res) => res.json())
    .then((data) => {
      if (data && data.success) {
        // Preenche nome e e-mail do dropdown
        document.getElementById("dropdownUserName").textContent =
          data.nome_completo || "Usuário";
        document.getElementById("dropdownUserBoxName").textContent =
          data.nome_completo || "Usuário";
        document.getElementById("dropdownUserEmail").textContent =
          data.email || "email@exemplo.com";
      } else {
        console.warn("Não logado ou erro:", data?.message);
        // Se quiser, pode redirecionar para login ou algo similar
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

  // 3) Buscar notificações e atualizar a badge + lista
  fetchNotifications();

  // 4) "Ver todas" notificações -> levar para outra página (opcional)
  const notifSeeAll = document.getElementById("notifSeeAll");
  if (notifSeeAll) {
    notifSeeAll.addEventListener("click", function (e) {
      e.preventDefault();
      // window.location.href = "/pages/notificacoes/listar.html";
      console.log("Clique em 'Ver todas as notificações'");
    });
  }
});

// Exemplo: função que recebe um array de IDs de notificações para marcar como lidas
async function marcarNotificacoesComoLidas(notificacaoIds) {
  try {
    const response = await fetch('/api/notificacoes/marcar-lido', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ notificacaoIds }),
    });
    const data = await response.json();
    if (data.success) {
      console.log('Notificações marcadas como lidas');
      // Atualizar a lista de notificações no front, etc.
    } else {
      console.error('Falha ao marcar notificações:', data.message);
    }
  } catch (error) {
    console.error('Erro:', error);
  }
}

