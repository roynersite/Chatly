// ==========================================
// CONFIGURACIÓN - REEMPLAZA CON TU URL
// ==========================================
const API_BASE_URL = 'https://whatsapp-api-74.220.48.0/24.onrender.com'; // ← TU URL DE RENDER
// const API_BASE_URL = 'http://localhost:5000'; // Para pruebas locales

const API_URL = `${API_BASE_URL}/api`;

// ==========================================
// FIREBASE CONFIG - REEMPLAZA CON TUS DATOS
// ==========================================
const firebaseConfig = {
    apiKey: "AIzaSyXXXXXXXXXXXXXXXXXXXXXXX",
    authDomain: "tu-proyecto.firebaseapp.com",
    projectId: "tu-proyecto",
    storageBucket: "tu-proyecto.appspot.com",
    messagingSenderId: "123456789",
    appId: "1:123456789:web:abcdef123456"
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

// ==========================================
// AUTENTICACIÓN CON GOOGLE
// ==========================================
document.getElementById('google-login').addEventListener('click', async () => {
    showLoading();
    try {
        const provider = new firebase.auth.GoogleAuthProvider();
        const result = await auth.signInWithPopup(provider);
        await handleAuthSuccess(result.user);
    } catch (error) {
        console.error('Error Google login:', error);
        alert('Error al iniciar sesión: ' + error.message);
    } finally {
        hideLoading();
    }
});

// ==========================================
// AUTENTICACIÓN CON TELÉFONO
// ==========================================
let confirmationResult = null;

document.getElementById('send-code-btn').addEventListener('click', async () => {
    const phoneInput = document.getElementById('phone-input');
    const countryCode = document.getElementById('country-code');
    const phoneNumber = countryCode.value + phoneInput.value.replace(/\s/g, '');
    
    if (!phoneInput.value) {
        alert('Ingresa un número de teléfono');
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
        
        alert('Código enviado a tu teléfono');
    } catch (error) {
        console.error('Error:', error);
        alert('Error: ' + error.message);
    } finally {
        hideLoading();
    }
});

document.getElementById('verify-code-btn').addEventListener('click', async () => {
    const code = document.getElementById('verification-code').value;
    
    if (!code || code.length !== 6) {
        alert('Ingresa el código de 6 dígitos');
        return;
    }
    
    showLoading();
    try {
        const result = await confirmationResult.confirm(code);
        await handleAuthSuccess(result.user);
    } catch (error) {
        alert('Código incorrecto');
    } finally {
        hideLoading();
    }
});

// ==========================================
// MANEJAR LOGIN EXITOSO
// ==========================================
async function handleAuthSuccess(firebaseUser) {
    try {
        const token = await firebaseUser.getIdToken();
        localStorage.setItem('auth_token', token);
        
        // LLAMADA REAL A LA API
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
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        currentUser = data.user;
        
        // Conectar WebSocket
        initializeSocket(token);
        
        showChatScreen();
        loadConversations();
        
    } catch (error) {
        console.error('Error:', error);
        alert('Error de conexión con el servidor: ' + error.message);
    }
}

// ==========================================
// WEBSOCKET (SOCKET.IO)
// ==========================================
function initializeSocket(token) {
    // Conectar al backend real
    socket = io(API_BASE_URL, {
        auth: { token },
        transports: ['websocket', 'polling']
    });
    
    socket.on('connect', () => {
        console.log('✅ Conectado al servidor:', API_BASE_URL);
    });
    
    socket.on('connect_error', (error) => {
        console.error('❌ Error de conexión:', error);
    });
    
    socket.on('new_message', (message) => {
        if (currentChat && 
            (message.sender._id === currentChat._id || 
             message.receiver._id === currentChat._id)) {
            addMessageToChat(message);
        }
        loadConversations();
    });
    
    socket.on('user_status', (data) => {
        updateUserStatus(data);
    });
}

// ==========================================
// CARGAR CONVERSACIONES
// ==========================================
async function loadConversations() {
    try {
        const token = localStorage.getItem('auth_token');
        
        // LLAMADA REAL A LA API
        const response = await fetch(`${API_URL}/conversations`, {
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error('Error cargando conversaciones');
        }
        
        conversations = await response.json();
        renderChatList();
    } catch (error) {
        console.error('Error:', error);
    }
}

// ==========================================
// ABRIR CHAT
// ==========================================
async function openChat(contact) {
    currentChat = contact;
    
    document.querySelectorAll('.chat-item').forEach(item => {
        item.classList.remove('active');
    });
    document.querySelector(`[data-user-id="${contact._id}"]`)?.classList.add('active');
    
    emptyState.classList.add('hidden');
    activeChat.classList.remove('hidden');
    
    document.getElementById('chat-contact-photo').src = contact.photoURL || 
        'https://via.placeholder.com/40';
    document.getElementById('chat-contact-name').textContent = contact.displayName;
    document.getElementById('chat-contact-status').textContent = 
        contact.isOnline ? 'En línea' : 'Última vez ' + formatLastSeen(contact.lastSeen);
    
    await loadMessages(contact._id);
}

// ==========================================
// CARGAR MENSAJES
// ==========================================
async function loadMessages(userId) {
    try {
        const token = localStorage.getItem('auth_token');
        
        // LLAMADA REAL A LA API
        const response = await fetch(`${API_URL}/messages/${userId}`, {
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error('Error cargando mensajes');
        }
        
        const messages = await response.json();
        renderMessages(messages);
    } catch (error) {
        console.error('Error:', error);
    }
}

// ==========================================
// ENVIAR MENSAJE
// ==========================================
async function sendMessage() {
    const input = document.getElementById('message-input');
    const content = input.value.trim();
    
    if (!content || !currentChat) return;
    
    // Enviar por WebSocket (tiempo real)
    if (socket) {
        socket.emit('send_message', {
            receiverId: currentChat._id,
            content: content,
            type: 'text'
        });
    }
    
    // También enviar por HTTP como respaldo
    try {
        const token = localStorage.getItem('auth_token');
        
        // LLAMADA REAL A LA API
        await fetch(`${API_URL}/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                receiverId: currentChat._id,
                content: content,
                type: 'text'
            })
        });
    } catch (error) {
        console.error('Error enviando:', error);
    }
    
    // Mostrar localmente
    const tempMessage = {
        sender: { _id: currentUser._id },
        content: content,
        createdAt: new Date(),
        read: false
    };
    addMessageToChat(tempMessage);
    
    input.value = '';
}

// ==========================================
// BUSCAR USUARIOS
// ==========================================
document.getElementById('search-users').addEventListener('input', debounce(async (e) => {
    const query = e.target.value;
    if (query.length < 3) return;
    
    try {
        const token = localStorage.getItem('auth_token');
        
        // LLAMADA REAL A LA API
        const response = await fetch(`${API_URL}/users/search?phone=${query}`, {
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const users = await response.json();
        renderSearchResults(users);
    } catch (error) {
        console.error('Error:', error);
    }
}, 500));

// ==========================================
// AGREGAR CONTACTO
// ==========================================
async function addContact(userId) {
    try {
        const token = localStorage.getItem('auth_token');
        
        // LLAMADA REAL A LA API
        await fetch(`${API_URL}/users/contacts`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ userId })
        });
    } catch (error) {
        console.error('Error:', error);
    }
}

// ==========================================
// FUNCIONES AUXILIARES
// ==========================================
function showChatScreen() {
    loginScreen.classList.add('hidden');
    chatScreen.classList.remove('hidden');
    document.getElementById('user-photo').src = currentUser.photoURL || 
        'https://via.placeholder.com/40';
}

function showLoading() {
    loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
    loadingOverlay.classList.add('hidden');
}

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

function renderMessages(messages) {
    const container = document.getElementById('messages-container');
    container.innerHTML = '';
    
    messages.forEach(msg => {
        addMessageToChat(msg, false);
    });
    
    container.scrollTop = container.scrollHeight;
}

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

// Event Listeners
document.getElementById('send-btn').addEventListener('click', sendMessage);
document.getElementById('message-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

document.getElementById('new-chat-btn').addEventListener('click', () => {
    document.getElementById('new-chat-modal').classList.remove('hidden');
});

document.getElementById('close-modal').addEventListener('click', () => {
    document.getElementById('new-chat-modal').classList.add('hidden');
});

// Verificar sesión al cargar
auth.onAuthStateChanged(async (user) => {
    if (user) {
        await handleAuthSuccess(user);
    }
});