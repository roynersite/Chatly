const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  firebaseUid: {
    type: String,
    required: true,
    unique: true
  },
  phoneNumber: {
    type: String,
    default: ''
  },
  email: {
    type: String,
    default: ''
  },
  displayName: {
    type: String,
    required: true
  },
  photoURL: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    default: 'Hola, estoy usando WhatsApp Clone'
  },
  contacts: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  isOnline: {
    type: Boolean,
    default: false
  },
  lastSeen: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('User', userSchema);