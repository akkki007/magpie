const sharp = require('sharp');
const fs = require('fs');

const BG='#0F1B2D', ACC='#FF9900', INK='#FFFFFF', MUT='#8892A4', DIM='#596579';
const F = 'Segoe UI, Arial, Helvetica, sans-serif';

function box(x, y, w, h, label, stroke, fill) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${fill||'none'}" stroke="${stroke}" stroke-width="2.5"/>
  <text x="${x + w/2}" y="${y + h/2 + 7}" font-family="${F}" font-size="19" font-weight="600" fill="${INK}" text-anchor="middle">${label}</text>`;
}
function arrow(x, y) {
  return `<path d="M${x} ${y} L${x+24} ${y}" stroke="${DIM}" stroke-width="2.5" fill="none"/>
  <path d="M${x+24} ${y-5} L${x+32} ${y} L${x+24} ${y+5} Z" fill="${DIM}"/>`;
}
function stat(x, value, label) {
  return `<text x="${x}" y="350" font-family="${F}" font-size="46" font-weight="700" fill="${INK}">${value}</text>
  <text x="${x}" y="380" font-family="${F}" font-size="17" font-weight="500" fill="${MUT}">${label}</text>`;
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${BG}"/>
  <rect x="0" y="0" width="14" height="630" fill="${ACC}"/>

  <text x="70" y="70" font-family="${F}" font-size="20" font-weight="700" fill="${ACC}" letter-spacing="1.6">MAGPIE  ·  AI-NATIVE FINANCE WORKSPACE</text>

  <text x="68" y="160" font-family="${F}" font-size="66" font-weight="700" fill="${INK}">11,269 bank credits.</text>
  <text x="68" y="232" font-family="${F}" font-size="66" font-weight="700" fill="${INK}">Zero matched wrong.</text>

  <text x="70" y="282" font-family="${F}" font-size="24" font-weight="400" fill="${MUT}">Reconciliation that abstains instead of guessing — and hands the rest to a human.</text>

  ${stat(70,  '100%',  'precision')}
  ${stat(340, '0',     'false matches')}
  ${stat(560, '98.6%', 'auto-matched')}
  ${stat(840, '6',     'left for a human')}

  <line x1="70" y1="418" x2="1130" y2="418" stroke="#1E2D44" stroke-width="1.5"/>

  ${box(70,  450, 150, 54, 'Browser', '#3B82F6')}
  ${arrow(228, 477)}
  ${box(264, 450, 130, 54, 'Caddy', '#FF9900')}
  ${arrow(402, 477)}
  ${box(438, 450, 110, 54, 'EC2', '#E8590C')}
  ${arrow(556, 477)}
  ${box(592, 450, 262, 54, 'RDS · no public IP', '#8B5CF6')}

  <text x="70" y="575" font-family="${F}" font-size="19" font-weight="500" fill="${DIM}">magpie.akkki.tech   ·   First Commit   ·   WeMakeDevs × AWS</text>
</svg>`;

fs.writeFileSync(__dirname + '/card.svg', svg);
sharp(Buffer.from(svg)).png().toFile(__dirname + '/magpie-card.png')
  .then(i => console.log('OK', i.width + 'x' + i.height))
  .catch(e => console.error('ERR', e.message));
