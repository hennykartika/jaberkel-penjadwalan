// server.js — Entry point Schedule Service (Modul Penjadwalan).
// Menyajikan REST API sekaligus frontend statis dari folder /public.
const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Rute API
app.use('/v1/auth', require('./routes/auth'));
app.use('/v1/schedules', require('./routes/schedules'));

// Health check
app.get('/health', (req, res) =>
  res.json({ success: true, service: 'Jaberkel Schedule Service', status: 'OK' })
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('========================================================');
  console.log('  Jaberkel — Schedule Service (Modul Penjadwalan)');
  console.log('  Henny Kartika · 6026252017');
  console.log('========================================================');
  console.log(`  Frontend : http://localhost:${PORT}`);
  console.log(`  API      : http://localhost:${PORT}/v1/schedules`);
  console.log('========================================================');
});
