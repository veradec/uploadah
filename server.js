const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const { createClient } = require('redis');

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});

const PORT = process.env.PORT || 3000;
const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin';

const redis = createClient({ url: REDIS_URL });
redis.on('error', (err) => console.error('Redis error:', err));

app.use(express.urlencoded({ extended: true }));

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return header.split(';').reduce((acc, part) => {
    const [k, ...rest] = part.trim().split('=');
    if (!k) return acc;
    acc[k] = decodeURIComponent(rest.join('='));
    return acc;
  }, {});
}

async function getSession(req) {
  const cookies = parseCookies(req);
  const token = cookies.admin_session;
  if (!token) return null;
  const user = await redis.get(`session:${token}`);
  return user || null;
}

async function requireAdmin(req, res, next) {
  const user = await getSession(req);
  if (user !== ADMIN_USER) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  req.adminUser = user;
  next();
}

function page(title, body, isAdmin = false) {
  const authLink = isAdmin ? '<a href="/logout">Logout</a>' : '<a href="/login">Admin Login</a>';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; }
    nav a { margin-right: 1rem; }
    .card { border: 1px solid #ddd; padding: 1rem; margin: 1rem 0; border-radius: 6px; }
    video { width: 100%; max-height: 480px; background: #000; }
    button { padding: 0.4rem 0.8rem; margin-right: 0.5rem; }
    .muted { color: #666; }
    input[type="text"], input[type="password"] { padding: 0.4rem; width: 100%; max-width: 300px; }
  </style>
</head>
<body>
  <nav>
    <a href="/">Home</a>
    <a href="/upload">Upload</a>
    <a href="/approval">Approval</a>
    ${authLink}
  </nav>
  <h1>${title}</h1>
  ${body}
</body>
</html>`;
}

async function getVideos(status) {
  const ids = await redis.lRange(`videos:${status}`, 0, -1);
  const videos = [];
  for (const id of ids) {
    const meta = await redis.hGetAll(`video:${id}:meta`);
    if (meta && meta.id) videos.push(meta);
  }
  return videos;
}

app.get('/', async (req, res) => {
  try {
    const videos = await getVideos('approved');
    const isAdmin = (await getSession(req)) === ADMIN_USER;
    const body = videos.length
      ? videos.map((v) => `
        <div class="card">
          <h3>${v.originalName}</h3>
          <p class="muted">Uploaded: ${v.uploadedAt}</p>
          <video controls src="/video/${v.id}"></video>
        </div>`).join('')
      : '<p>No approved videos yet.</p>';
    res.send(page('Approved Videos', body, isAdmin));
  } catch (err) {
    console.error(err);
    res.status(500).send(page('Error', '<p>Failed to load videos.</p>'));
  }
});

app.get('/upload', async (req, res) => {
  const msg = req.query.ok ? '<p>Video uploaded and pending approval.</p>' : '';
  const isAdmin = (await getSession(req)) === ADMIN_USER;
  res.send(page('Upload Video', `
    ${msg}
    <form method="post" action="/upload" enctype="multipart/form-data" class="card">
      <label>Choose video file<br/><br/>
        <input type="file" name="video" accept="video/*" required />
      </label>
      <br/><br/>
      <button type="submit">Upload</button>
    </form>`, isAdmin));
});

app.post('/upload', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).send(page('Upload Error', '<p>No file uploaded.</p>'));
    const id = crypto.randomUUID();
    const meta = {
      id,
      originalName: req.file.originalname || 'video',
      mimeType: req.file.mimetype || 'application/octet-stream',
      size: String(req.file.size),
      status: 'pending',
      uploadedAt: new Date().toISOString()
    };
    await redis.hSet(`video:${id}:meta`, meta);
    await redis.set(`video:${id}:data`, req.file.buffer.toString('base64'));
    await redis.lPush('videos:pending', id);
    res.redirect('/upload?ok=1');
  } catch (err) {
    console.error(err);
    res.status(500).send(page('Upload Error', '<p>Failed to upload video.</p>'));
  }
});

app.get('/login', async (req, res) => {
  const isAdmin = (await getSession(req)) === ADMIN_USER;
  if (isAdmin) return res.redirect(req.query.next || '/approval');
  const err = req.query.error ? '<p>Invalid username or password.</p>' : '';
  const next = req.query.next || '/approval';
  res.send(page('Admin Login', `
    ${err}
    <form method="post" action="/login" class="card">
      <input type="hidden" name="next" value="${next}" />
      <label>Username<br/><input type="text" name="username" required /></label><br/><br/>
      <label>Password<br/><input type="password" name="password" required /></label><br/><br/>
      <button type="submit">Login</button>
    </form>
    <p class="muted">Default credentials: admin / admin</p>`, false));
});

app.post('/login', async (req, res) => {
  const { username, password, next } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const token = crypto.randomUUID();
    await redis.set(`session:${token}`, username, { EX: 60 * 60 * 8 });
    res.setHeader('Set-Cookie', `admin_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${60 * 60 * 8}`);
    return res.redirect(next && next.startsWith('/') ? next : '/approval');
  }
  res.redirect('/login?error=1&next=' + encodeURIComponent(next || '/approval'));
});

app.get('/logout', async (req, res) => {
  const cookies = parseCookies(req);
  const token = cookies.admin_session;
  if (token) await redis.del(`session:${token}`);
  res.setHeader('Set-Cookie', 'admin_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
  res.redirect('/');
});

app.get('/approval', requireAdmin, async (req, res) => {
  try {
    const videos = await getVideos('pending');
    const body = videos.length
      ? videos.map((v) => `
        <div class="card">
          <h3>${v.originalName}</h3>
          <p class="muted">Size: ${v.size} bytes | Uploaded: ${v.uploadedAt}</p>
          <video controls src="/video/${v.id}"></video>
          <form method="post" action="/approval/${v.id}" style="margin-top:0.5rem;">
            <button name="action" value="approve" type="submit">Approve</button>
            <button name="action" value="reject" type="submit">Reject</button>
          </form>
        </div>`).join('')
      : '<p>No videos pending approval.</p>';
    res.send(page('Approval Queue', body, true));
  } catch (err) {
    console.error(err);
    res.status(500).send(page('Error', '<p>Failed to load approval queue.</p>', true));
  }
});

app.post('/approval/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const action = req.body.action;
  try {
    const exists = await redis.exists(`video:${id}:meta`);
    if (!exists) return res.status(404).send(page('Not Found', '<p>Video not found.</p>', true));
    await redis.lRem('videos:pending', 0, id);
    await redis.lRem('videos:approved', 0, id);
    await redis.lRem('videos:rejected', 0, id);
    if (action === 'approve') {
      await redis.hSet(`video:${id}:meta`, 'status', 'approved');
      await redis.lPush('videos:approved', id);
    } else {
      await redis.hSet(`video:${id}:meta`, 'status', 'rejected');
      await redis.lPush('videos:rejected', id);
    }
    res.redirect('/approval');
  } catch (err) {
    console.error(err);
    res.status(500).send(page('Error', '<p>Failed to update approval status.</p>', true));
  }
});

app.get('/video/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [meta, data] = await Promise.all([
      redis.hGetAll(`video:${id}:meta`),
      redis.get(`video:${id}:data`)
    ]);
    if (!meta || !meta.id || !data) return res.status(404).send('Not found');
    const buf = Buffer.from(data, 'base64');
    res.setHeader('Content-Type', meta.mimeType || 'application/octet-stream');
    res.setHeader('Content-Length', buf.length);
    res.send(buf);
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to stream video');
  }
});

async function start() {
  await redis.connect();
  app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
