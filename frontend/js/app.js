// Configuración de Firebase - REEMPLAZA CON TUS PROPIAS CREDENCIALES
const firebaseConfig = {
    apiKey: "TU_API_KEY",
    authDomain: "TU_PROYECTO.firebaseapp.com",
    projectId: "TU_PROYECTO",
    storageBucket: "TU_PROYECTO.appspot.com",
    messagingSenderId: "TU_SENDER_ID",
    appId: "TU_APP_ID"
};

// Inicializar Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();

// Variables globales
let currentUser = null;
let socket = null;
let currentChat = null;
let conversations = [];

// Elementos del DOM
const loginScreen = document.getElementById('login-screen');
const chatScreen = document.getElementById('chat-screen');
const emptyState = document.getElementById('empty-state');
const activeChat = document.getElementById('active-chat');
const loadingOverlay = document.getElementById('loading-overlay');

// API URL
const API_URL = 'http://localhost:5000/api';

// ==================== AUTENTICACIÓN ====================

// Login con Google
document.getElementById('google-login').addEventListener('click', async () => {
    showLoading();
    try {
        const provider = new firebase.auth.GoogleAuthProvider();
        const result = await auth.signInWithPopup(provider);
        await handleAuthSuccess(result.user);
    } catch (error) {
        console.error('Error Google login:', error);
        alert('Error al iniciar sesión con Google: ' + error.message);
    } finally {
        hideLoading();
    }
});

// Login con teléfono
let confirmationResult = null;

document.getElementById('send-code-btn').addEventListener('click', async () => {
    const phoneInput = document.getElementById('phone-input');
    const countryCode = document.getElementById('country-code');
    const phoneNumber = countryCode.value + phoneInput.value.replace(/\s/g, '');
    
    if (!phoneInput.value) {
        alert('Por favor ingresa un número de teléfono');
        return;
    }
    
    showLoading();
    try {
        const appVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', {
            size: 'invisible'
        });
        
        confirmationResult = await auth.signInWithPhoneNumber(phoneNumber, appVerifier);
        
        document.getElementById('verification-container').classList.remove('hidden');
        document.querySelector('.phone-login').classList.add('hidden');
        
        alert('Código enviado. Por favor revisa tu teléfono.');
    } catch (error) {
        console.error('Error enviando código:', error);
        alert('Error: ' + error.message);
    } finally {
        hideLoading();
    }
});

document.getElementById('verify-code-btn').addEventListener('click', async () => {
    const code = document.getElementById('verification-code').value;
    
    if (!code || code.length !== 6) {
        alert('Por favor ingresa el código de 6 dígitos');
        return;
    }
    
    showLoading();
    try {
        const result = await confirmationResult.confirm(code);
        await handleAuthSuccess(result.user);
    } catch (error) {
        console.error('Error verificando código:', error);
        alert('Código incorrecto: ' + error.message);
    } finally {
        hideLoading();
    }
});

// Manejar autenticación exitosa
async function handleAuthSuccess(firebaseUser) {
    try {
        // Obtener token de Firebase
        const token = await firebaseUser.getIdToken();
        localStorage.setItem('auth_token', token);
        
        // Verificar/crear usuario en el backend
        const response = await fetch(`${API_URL}/auth/verify`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                uid: firebaseUser.uid,
                phoneNumber: firebaseUser.phoneNumber || '',
                email: firebaseUser.email || '',
                displayName: firebaseUser.displayName || 'Usuario',
                photoURL: firebaseUser.photoURL || ''
            })
        });
        
        const data = await response.json();
        currentUser = data.user;
        
        // Inicializar Socket.io
        initializeSocket(token);
        
        // Mostrar pantalla de chat
        showChatScreen();
        
        // Cargar conversaciones
        loadConversations();
        
    } catch (error) {
        console.error('Error:', error);
        alert('Error al inicializar: ' + error.message);
    }
}

// ==================== SOCKET.IO ====================

function initializeSocket(token) {
    socket = io('http://localhost:5000', {
        auth: { token }
    });
    
    socket.on('connect', () => {
        console.log('Conectado al servidor');
    });
    
    socket.on('new_message', (message) => {
        // Agregar mensaje a la conversación actual
        if (currentChat && 
            (message.sender._id === currentChat._id || 
             message.receiver._id === currentChat._id)) {
            addMessageToChat(message);
        }
        // Actualizar lista de chats
        loadConversations();
    });
    
    socket.on('user_status', (data) => {
        updateUserStatus(data);
    });
    
    socket.on('user_typing', (data) => {
        showTypingIndicator(data);
    });
}

// ==================== UI FUNCTIONS ====================

function showChatScreen() {
    loginScreen.classList.add('hidden');
    chatScreen.classList.remove('hidden');
    
    // Actualizar UI con datos del usuario
    document.getElementById('user-photo').src = currentUser.photoURL || 
        'https://via.placeholder.com/40';
}

function showLoading() {
    loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
    loadingOverlay.classList.add('hidden');
}

// ==================== CHAT FUNCTIONS ====================

// Cargar conversaciones
async function loadConversations() {
    try {
        const token = localStorage.getItem('auth_token');
        const response = await fetch(`${API_URL}/conversations`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        conversations = await response.json();
        renderChatList();
    } catch (error) {
        console.error('Error cargando conversaciones:', error);
    }
}

// Renderizar lista de chats
function renderChatList() {
    const chatList = document.getElementById('chat-list');
    chatList.innerHTML = '';
    
    conversations.forEach(conv => {
        const chatItem = document.createElement('div');
        chatItem.className = 'chat-item';
        chatItem.dataset.userId = conv.contact._id;
        
        const lastMessage = conv.lastMessage;
        const time = new Date(lastMessage.createdAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
        });
        
        chatItem.innerHTML = `
            <div class="chat-avatar">
                <img src="${conv.contact.photoURL || 'https://via.placeholder.com/50'}" alt="${conv.contact.displayName}">
            </div>
            <div class="chat-info">
                <div class="chat-header-row">
                    <span class="chat-name">${conv.contact.displayName}</span>
                    <span class="chat-time">${time}</span>
                </div>
                <div class="chat-preview">
                    <span class="chat-message">${lastMessage.content}</span>
                    ${conv.unreadCount > 0 ? `<span class="unread-badge">${conv.unreadCount}</span>` : ''}
                </div>
            </div>
        `;
        
        chatItem.addEventListener('click', () => openChat(conv.contact));
        chatList.appendChild(chatItem);
    });
}

// Abrir chat
async function openChat(contact) {
    currentChat = contact;
    
    // Actualizar UI
    document.querySelectorAll('.chat-item').forEach(item => {
        item.classList.remove('active');
    });
    document.querySelector(`[data-user-id="${contact._id}"]`)?.classList.add('active');
    
    emptyState.classList.add('hidden');
    activeChat.classList.remove('hidden');
    
    // Actualizar header del chat
    document.getElementById('chat-contact-photo').src = contact.photoURL || 
        'https://via.placeholder.com/40';
    document.getElementById('chat-contact-name').textContent = contact.displayName;
    document.getElementById('chat-contact-status').textContent = 
        contact.isOnline ? 'En línea' : 'Última vez ' + formatLastSeen(contact.lastSeen);
    
    // Cargar mensajes
    await loadMessages(contact._id);
}

// Cargar mensajes
async function loadMessages(userId) {
    try {
        const token = localStorage.getItem('auth_token');
        const response = await fetch(`${API_URL}/messages/${userId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const messages = await response.json();
        renderMessages(messages);
    } catch (error) {
        console.error('Error cargando mensajes:', error);
    }
}

// Renderizar mensajes
function renderMessages(messages) {
    const container = document.getElementById('messages-container');
    container.innerHTML = '';
    
    messages.forEach(msg => {
        addMessageToChat(msg, false);
    });
    
    // Scroll al final
    container.scrollTop = container.scrollHeight;
}

// Agregar mensaje al chat
function addMessageToChat(message, append = true) {
    const container = document.getElementById('messages-container');
    const isSent = message.sender._id === currentUser._id || 
                   message.sender === currentUser._id;
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${isSent ? 'sent' : 'received'}`;
    
    const time = new Date(message.createdAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
    });
    
    messageDiv.innerHTML = `
        <div class="message-content">${escapeHtml(message.content)}</div>
        <span class="message-time">${time}</span>
        ${isSent ? `
            <span class="message-status">
                <svg viewBox="0 0 24 24"><path d="M18 6L7 17l-5-5 1.41-1.41L7 14.17 16.59 4.59 18 6z"/></svg>
            </span>
        ` : ''}
    `;
    
    if (append) {
        container.appendChild(messageDiv);
        container.scrollTop = container.scrollHeight;
    } else {
        container.appendChild(messageDiv);
    }
}

// Enviar mensaje
document.getElementById('send-btn').addEventListener('click', sendMessage);
document.getElementById('message-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

async function sendMessage() {
    const input = document.getElementById('message-input');
    const content = input.value.trim();
    
    if (!content || !currentChat) return;
    
    // Emitir a través de Socket.io para tiempo real
    socket.emit('send_message', {
        receiverId: currentChat._id,
        content: content,
        type: 'text'
    });
    
    // Agregar mensaje localmente inmediatamente
    const tempMessage = {
        sender: { _id: currentUser._id },
        content: content,
        createdAt: new Date(),
        read: false
    };
    addMessageToChat(tempMessage);
    
    input.value = '';
}

// Buscar usuarios
document.getElementById('new-chat-btn').addEventListener('click', () => {
    document.getElementById('new-chat-modal').classList.remove('hidden');
});

document.getElementById('close-modal').addEventListener('click', () => {
    document.getElementById('new-chat-modal').classList.add('hidden');
});

document.getElementById('search-users').addEventListener('input', debounce(async (e) => {
    const query = e.target.value;
    if (query.length < 3) return;
    
    try {
        const token = localStorage.getItem('auth_token');
        const response = await fetch(`${API_URL}/users/search?phone=${query}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const users = await response.json();
        renderSearchResults(users);
    } catch (error) {
        console.error('Error buscando usuarios:', error);
    }
}, 500));

function renderSearchResults(users) {
    const container = document.getElementById('search-results');
    container.innerHTML = '';
    
    users.forEach(user => {
        const div = document.createElement('div');
        div.className = 'user-result';
        div.innerHTML = `
            <img src="${user.photoURL || 'https://via.placeholder.com/40'}" alt="${user.displayName}">
            <div class="user-result-info">
                <h4>${user.displayName}</h4>
                <p>${user.phoneNumber || user.email}</p>
            </div>
        `;
        
        div.addEventListener('click', async () => {
            await addContact(user._id);
            document.getElementById('new-chat-modal').classList.add('hidden');
            loadConversations();
        });
        
        container.appendChild(div);
    });
}

async function addContact(userId) {
    try {
        const token = localStorage.getItem('auth_token');
        await fetch(`${API_URL}/users/contacts`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ userId })
        });
    } catch (error) {
        console.error('Error agregando contacto:', error);
    }
}

// ==================== UTILIDADES ====================

function formatLastSeen(date) {
    const d = new Date(date);
    const now = new Date();
    const diff = now - d;
    
    if (diff < 60000) return 'hace un momento';
    if (diff < 3600000) return `hace ${Math.floor(diff/60000)} minutos`;
    if (diff < 86400000) return `hace ${Math.floor(diff/3600000)} horas`;
    return d.toLocaleDateString();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function updateUserStatus(data) {
    if (currentChat && currentChat._id === data.userId) {
        const statusEl = document.getElementById('chat-contact-status');
        if (data.isOnline) {
            statusEl.textContent = 'En línea';
        } else {
            statusEl.textContent = 'Última vez ' + formatLastSeen(data.lastSeen);
        }
    }
}

function showTypingIndicator(data) {
    if (currentChat && currentChat._id === data.userId) {
        const statusEl = document.getElementById('chat-contact-status');
        if (data.isTyping) {
            statusEl.textContent = 'Escribiendo...';
        } else {
            statusEl.textContent = data.isOnline ? 'En línea' : 'Desconectado';
        }
    }
}

// Detectar escritura
let typingTimeout;
document.getElementById('message-input').addEventListener('input', () => {
    if (!currentChat || !socket) return;
    
    socket.emit('typing', { receiverId: currentChat._id, isTyping: true });
    
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        socket.emit('typing', { receiverId: currentChat._id, isTyping: false });
    }, 1000);
});

// Verificar sesión al cargar
auth.onAuthStateChanged(async (user) => {
    if (user) {
        await handleAuthSuccess(user);
    }
});