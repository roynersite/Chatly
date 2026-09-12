const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const admin = require('firebase-admin');

dotenv.config();

// Inicializar Firebase Admin
const serviceAccount = require('./config/firebase-service-account.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(express.json());

// Conectar a MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/whatsapp_clone', {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

// Modelos
const User = require('./models/User');
const Message = require('./models/Message');

// Middleware de autenticación
const authenticateToken = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.sendStatus(401);

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    res.sendStatus(403);
  }
};

// ===== RUTAS DE AUTENTICACIÓN =====

// Verificar/crear usuario después del login con Firebase
app.post('/api/auth/verify', async (req, res) => {
  try {
    const { uid, phoneNumber, email, displayName, photoURL } = req.body;
    
    let user = await User.findOne({ firebaseUid: uid });
    
    if (!user) {
      user = new User({
        firebaseUid: uid,
        phoneNumber: phoneNumber || '',
        email: email || '',
        displayName: displayName || 'Usuario',
        photoURL: photoURL || '',
        status: 'Hola, estoy usando WhatsApp Clone',
        lastSeen: new Date(),
        isOnline: true
      });
      await user.save();
    } else {
      user.isOnline = true;
      user.lastSeen = new Date();
      await user.save();
    }
    
    res.json({ success: true, user });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Obtener usuario actual
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Buscar usuarios por teléfono
app.get('/api/users/search', authenticateToken, async (req, res) => {
  try {
    const { phone } = req.query;
    const users = await User.find({ 
      phoneNumber: { $regex: phone, $options: 'i' },
      firebaseUid: { $ne: req.user.uid }
    }).limit(20);
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener todos los contactos del usuario
app.get('/api/users/contacts', authenticateToken, async (req, res) => {
  try {
    const currentUser = await User.findOne({ firebaseUid: req.user.uid });
    const contacts = await User.find({ 
      firebaseUid: { $in: currentUser.contacts || [] }
    });
    res.json(contacts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Agregar contacto
app.post('/api/users/contacts', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.body;
    const currentUser = await User.findOne({ firebaseUid: req.user.uid });
    
    if (!currentUser.contacts.includes(userId)) {
      currentUser.contacts.push(userId);
      await currentUser.save();
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== RUTAS DE MENSAJES =====

// Obtener conversaciones
app.get('/api/conversations', authenticateToken, async (req, res) => {
  try {
    const currentUser = await User.findOne({ firebaseUid: req.user.uid });
    
    const conversations = await Message.aggregate([
      {
        $match: {
          $or: [
            { sender: currentUser._id },
            { receiver: currentUser._id }
          ]
        }
      },
      {
        $sort: { createdAt: -1 }
      },
      {
        $group: {
          _id: {
            $cond: [
              { $eq: ["$sender", currentUser._id] },
              "$receiver",
              "$sender"
            ]
          },
          lastMessage: { $first: "$$ROOT" },
          unreadCount: {
            $sum: {
              $cond: [
                { $and: [
                  { $ne: ["$sender", currentUser._id] },
                  { $eq: ["$read", false] }
                ]},
                1,
                0
              ]
            }
          }
        }
      },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "contact"
        }
      },
      {
        $unwind: "$contact"
      }
    ]);
    
    res.json(conversations);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener mensajes con un usuario específico
app.get('/api/messages/:userId', authenticateToken, async (req, res) => {
  try {
    const currentUser = await User.findOne({ firebaseUid: req.user.uid });
    const otherUserId = req.params.userId;
    
    const messages = await Message.find({
      $or: [
        { sender: currentUser._id, receiver: otherUserId },
        { sender: otherUserId, receiver: currentUser._id }
      ]
    }).sort({ createdAt: 1 }).limit(100);
    
    // Marcar mensajes como leídos
    await Message.updateMany(
      { sender: otherUserId, receiver: currentUser._id, read: false },
      { $set: { read: true } }
    );
    
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Enviar mensaje
app.post('/api/messages', authenticateToken, async (req, res) => {
  try {
    const { receiverId, content, type = 'text' } = req.body;
    const currentUser = await User.findOne({ firebaseUid: req.user.uid });
    
    const message = new Message({
      sender: currentUser._id,
      receiver: receiverId,
      content,
      type,
      read: false,
      createdAt: new Date()
    });
    
    await message.save();
    
    // Populate sender info
    await message.populate('sender receiver');
    
    // Emitir a través de Socket.io
    io.to(receiverId.toString()).emit('new_message', message);
    io.to(currentUser._id.toString()).emit('message_sent', message);
    
    res.json(message);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Actualizar perfil
app.put('/api/users/profile', authenticateToken, async (req, res) => {
  try {
    const { displayName, status, photoURL } = req.body;
    const user = await User.findOneAndUpdate(
      { firebaseUid: req.user.uid },
      { displayName, status, photoURL },
      { new: true }
    );
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== SOCKET.IO =====

const connectedUsers = new Map();

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    const decodedToken = await admin.auth().verifyIdToken(token);
    socket.userId = decodedToken.uid;
    next();
  } catch (error) {
    next(new Error('Authentication error'));
  }
});

io.on('connection', async (socket) => {
  console.log('Usuario conectado:', socket.userId);
  
  const user = await User.findOne({ firebaseUid: socket.userId });
  if (user) {
    connectedUsers.set(user._id.toString(), socket.id);
    socket.join(user._id.toString());
    
    // Actualizar estado a online
    user.isOnline = true;
    await user.save();
    
    // Notificar a contactos
    io.emit('user_status', { userId: user._id, isOnline: true });
  }
  
  // Escuchar mensajes en tiempo real
  socket.on('send_message', async (data) => {
    try {
      const { receiverId, content, type } = data;
      
      const message = new Message({
        sender: user._id,
        receiver: receiverId,
        content,
        type,
        read: false,
        createdAt: new Date()
      });
      
      await message.save();
      await message.populate('sender receiver');
      
      // Enviar al receptor si está conectado
      io.to(receiverId.toString()).emit('new_message', message);
      socket.emit('message_sent', message);
    } catch (error) {
      console.error('Error sending message:', error);
    }
  });
  
  // Escuchar escritura
  socket.on('typing', (data) => {
    const { receiverId, isTyping } = data;
    io.to(receiverId.toString()).emit('user_typing', {
      userId: user._id,
      isTyping
    });
  });
  
  // Desconexión
  socket.on('disconnect', async () => {
    console.log('Usuario desconectado:', socket.userId);
    if (user) {
      connectedUsers.delete(user._id.toString());
      user.isOnline = false;
      user.lastSeen = new Date();
      await user.save();
      io.emit('user_status', { userId: user._id, isOnline: false, lastSeen: user.lastSeen });
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});