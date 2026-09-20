const sharp = require('sharp');
const fs = require('fs');

const F = 'Segoe UI, Arial, Helvetica, sans-serif';
const INK = '#111111', SUB = '#6B7280', LINE = '#D4D6DA', CARD = '#FFFFFF', SOFT = '#9CA3AF';

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function nbox(x, y, w, h, n, title, subs, opt) {
  opt = opt || {};
  const dark = !!opt.dark, dash = !!opt.dash;
  const fill = dark ? '#111111' : CARD;
  const stroke = dark ? '#111111' : (opt.strong ? '#111111' : LINE);
  const sw = (dark || opt.strong) ? 2 : 1.3;
  const tcol = dark ? '#FFFFFF' : INK;
  const scol = dark ? '#C9CDD3' : SUB;
  let o = '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="3" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + sw + '"' + (dash ? ' stroke-dasharray="5 4"' : '') + '/>';
  let tx = x + 18;
  if (n) {
    const cx = x + 21, cy = y + 27;
    o += '<circle cx="' + cx + '" cy="' + cy + '" r="10.5" fill="' + (dark ? '#FFFFFF' : '#111111') + '"/>';
    o += '<text x="' + cx + '" y="' + (cy + 4.5) + '" font-family="' + F + '" font-size="12.5" font-weight="700" fill="' + (dark ? '#111111' : '#FFFFFF') + '" text-anchor="middle">' + n + '</text>';
    tx = x + 40;
  }
  o += '<text x="' + tx + '" y="' + (y + 32) + '" font-family="' + F + '" font-size="16.5" font-weight="700" fill="' + tcol + '">' + esc(title) + '</text>';
  subs.forEach((s, i) => {
    o += '<text x="' + (x + 18) + '" y="' + (y + 56 + i * 18) + '" font-family="' + F + '" font-size="13" font-weight="400" fill="' + scol + '">' + esc(s) + '</text>';
  });
  return o;
}

function arrowR(x1, y, x2, col) {
  col = col || INK;
  return '<path d="M' + x1 + ' ' + y + ' L' + (x2 - 8) + ' ' + y + '" stroke="' + col + '" stroke-width="1.6" fill="none"/>' +
    '<path d="M' + (x2 - 8) + ' ' + (y - 4.5) + ' L' + x2 + ' ' + y + ' L' + (x2 - 8) + ' ' + (y + 4.5) + ' Z" fill="' + col + '"/>';
}
function arrowD(x, y1, y2, col) {
  col = col || INK;
  return '<path d="M' + x + ' ' + y1 + ' L' + x + ' ' + (y2 - 8) + '" stroke="' + col + '" stroke-width="1.6" fill="none"/>' +
    '<path d="M' + (x - 4.5) + ' ' + (y2 - 8) + ' L' + x + ' ' + y2 + ' L' + (x + 4.5) + ' ' + (y2 - 8) + ' Z" fill="' + col + '"/>';
}
function arrowUdash(x, y1, y2) {
  return '<path d="M' + x + ' ' + y1 + ' L' + x + ' ' + (y2 + 8) + '" stroke="' + INK + '" stroke-width="1.5" fill="none" stroke-dasharray="5 4"/>' +
    '<path d="M' + (x - 4.5) + ' ' + (y2 + 8) + ' L' + x + ' ' + y2 + ' L' + (x + 4.5) + ' ' + (y2 + 8) + ' Z" fill="' + INK + '"/>';
}
function group(x, y, w, h, label) {
  return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="3" fill="none" stroke="' + LINE + '" stroke-width="1.3"/>' +
    '<text x="' + (x + 20) + '" y="' + (y + 27) + '" font-family="' + F + '" font-size="13.5" font-weight="500" fill="' + SUB + '">' + esc(label) + '</text>';
}
function loopStep(x, y, w, h, n, label) {
  return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="3" fill="' + CARD + '" stroke="' + INK + '" stroke-width="1.4" stroke-dasharray="5 4"/>' +
    '<text x="' + (x + w / 2) + '" y="' + (y + h / 2 + 5) + '" font-family="' + F + '" font-size="13.5" font-weight="600" fill="' + INK + '" text-anchor="middle">' + esc(n + '  ' + label) + '</text>';
}

const W = 1400, H = 780;

const inX = 52, inY = 96, inW = 1296, inH = 604;
const gAx = 76, gAy = 126, gAw = 830, gAh = 434;
const gBx = 930, gBy = 126, gBw = 394, gBh = 434;
const r1y = 200, r1h = 90, r1c = r1y + 45;
const r2y = 400, r2h = 90, r2c = r2y + 45;
const bw = 170;
const b1 = 98, b2 = 303, b3 = 508, b4 = 713;
const gbx = 952, gbw = 350, gbh = 76;
const gb = [176, 272, 368, 464];
const loopY = 596, loopH = 36;

let s = '';
s += '<rect width="' + W + '" height="' + H + '" fill="#F2F2F3"/>';
s += '<rect x="24" y="24" width="' + (W - 48) + '" height="' + (H - 48) + '" rx="5" fill="' + CARD + '" stroke="#E3E5E8" stroke-width="1.3"/>';

s += '<text x="52" y="64" font-family="' + F + '" font-size="17" font-weight="600" fill="' + INK + '">The Magpie reconciliation flow</text>';
s += '<rect x="1148" y="42" width="200" height="34" rx="3" fill="' + CARD + '" stroke="' + LINE + '" stroke-width="1.3"/>';
s += '<text x="1248" y="64" font-family="' + F + '" font-size="13.5" font-weight="600" fill="' + INK + '" text-anchor="middle">magpie.akkki.tech</text>';

s += '<rect x="' + inX + '" y="' + inY + '" width="' + inW + '" height="' + inH + '" rx="4" fill="none" stroke="#E3E5E8" stroke-width="1.3"/>';

s += group(gAx, gAy, gAw, gAh, 'Your AWS account  \u00B7  EC2 (t3.small), one Docker network');
s += group(gBx, gBy, gBw, gBh, 'Where it goes');

s += nbox(b1, r1y, bw, r1h, '1', 'Review screen', ['upload CSVs,', 'resolve exceptions']);
s += nbox(b2, r1y, bw, r1h, '2', 'Caddy', ['auto Let\u2019s Encrypt cert,', 'proxies to :3000']);
s += nbox(b3, r1y, bw, r1h, '3', 'Ingest', ['typed rejections,', 'missing column named']);
s += nbox(b4, r1y, bw, r1h, '4', 'Rule matcher', ['references, fees, TDS,', 'split payouts \u2014 no model'], { dark: true });

s += arrowR(b1 + bw, r1c, b2);
s += arrowR(b2 + bw, r1c, b3);
s += arrowR(b3 + bw, r1c, b4);

const annX = (b3 + bw + b4) / 2;
s += '<text x="' + annX + '" y="' + (r1y - 14) + '" font-family="' + F + '" font-size="13" font-weight="500" fill="' + INK + '" text-anchor="middle">5 malformed rows</text>';
s += '<line x1="' + (annX - 53) + '" y1="' + (r1y - 18.5) + '" x2="' + (annX + 53) + '" y2="' + (r1y - 18.5) + '" stroke="' + INK + '" stroke-width="1.3"/>';

s += nbox(b2, r2y, bw, r2h, null, 'Secrets Manager', ['fetched at boot,', 'one secret ARN'], { dash: true });
s += arrowUdash(b2 + bw / 2, r2y, r1y + r1h);

s += nbox(b4, r2y, bw, r2h, '5', 'Escalation', ['ranked candidates,', 'gap in paise and days']);
s += arrowD(b4 + bw / 2, r1y + r1h, r2y);

s += nbox(gbx, gb[0], gbw, gbh, null, 'RDS Postgres', ['no public IP, VPC-private, SSL']);
s += nbox(gbx, gb[1], gbw, gbh, null, 'S3', ['private, versioned archive of every upload']);
s += nbox(gbx, gb[2], gbw, gbh, null, 'CloudWatch + SNS', ['six alarms, 5xx metric filter, email']);
s += nbox(gbx, gb[3], gbw, gbh, '6', 'OpenAI', ['judgment on the residue only \u2014 never the arithmetic'], { strong: true });

// 4 -> RDS (solid grey)
s += '<path d="M' + (b4 + bw) + ' ' + r1c + ' L912 ' + r1c + ' L912 ' + (gb[0] + gbh / 2) + ' L' + (gbx - 8) + ' ' + (gb[0] + gbh / 2) + '" stroke="' + SOFT + '" stroke-width="1.5" fill="none"/>' +
  '<path d="M' + (gbx - 8) + ' ' + (gb[0] + gbh / 2 - 4.5) + ' L' + gbx + ' ' + (gb[0] + gbh / 2) + ' L' + (gbx - 8) + ' ' + (gb[0] + gbh / 2 + 4.5) + ' Z" fill="' + SOFT + '"/>';

// 3 -> S3 (dashed, along the clear channel between the two rows)
s += '<path d="M' + (b3 + bw / 2) + ' ' + (r1y + r1h) + ' L' + (b3 + bw / 2) + ' 345 L924 345 L924 ' + (gb[1] + gbh / 2) + ' L' + (gbx - 8) + ' ' + (gb[1] + gbh / 2) + '" stroke="' + SOFT + '" stroke-width="1.5" fill="none" stroke-dasharray="5 4"/>' +
  '<path d="M' + (gbx - 8) + ' ' + (gb[1] + gbh / 2 - 4.5) + ' L' + gbx + ' ' + (gb[1] + gbh / 2) + ' L' + (gbx - 8) + ' ' + (gb[1] + gbh / 2 + 4.5) + ' Z" fill="' + SOFT + '"/>';

// the whole EC2 box -> CloudWatch (dashed, straight off the group edge)
s += '<path d="M' + (gAx + gAw) + ' ' + (gb[2] + gbh / 2) + ' L' + (gbx - 8) + ' ' + (gb[2] + gbh / 2) + '" stroke="' + SOFT + '" stroke-width="1.5" fill="none" stroke-dasharray="5 4"/>' +
  '<path d="M' + (gbx - 8) + ' ' + (gb[2] + gbh / 2 - 4.5) + ' L' + gbx + ' ' + (gb[2] + gbh / 2) + ' L' + (gbx - 8) + ' ' + (gb[2] + gbh / 2 + 4.5) + ' Z" fill="' + SOFT + '"/>';
s += '<text x="' + (gAx + gAw + 6) + '" y="' + (gb[2] + gbh / 2 - 9) + '" font-family="' + F + '" font-size="11.5" font-weight="500" fill="' + SOFT + '">logs</text>';

// 5 -> 6 OpenAI (solid, the main flow)
s += '<path d="M' + (b4 + bw) + ' ' + r2c + ' L906 ' + r2c + ' L906 ' + (gb[3] + gbh / 2) + ' L' + (gbx - 8) + ' ' + (gb[3] + gbh / 2) + '" stroke="' + INK + '" stroke-width="1.6" fill="none"/>' +
  '<path d="M' + (gbx - 8) + ' ' + (gb[3] + gbh / 2 - 4.5) + ' L' + gbx + ' ' + (gb[3] + gbh / 2) + ' L' + (gbx - 8) + ' ' + (gb[3] + gbh / 2 + 4.5) + ' Z" fill="' + INK + '"/>';

const L7x = 930, L7w = 326, L8x = 536, L8w = 326, L9x = 142, L9w = 326;
const loopC = loopY + loopH / 2;

s += '<path d="M' + (gbx + gbw) + ' ' + (gb[3] + gbh / 2) + ' L' + (inX + inW - 18) + ' ' + (gb[3] + gbh / 2) + ' L' + (inX + inW - 18) + ' ' + loopC + ' L' + (L7x + L7w) + ' ' + loopC + '" stroke="' + INK + '" stroke-width="1.5" fill="none" stroke-dasharray="5 4"/>';
s += '<path d="M' + L7x + ' ' + loopC + ' L' + (L8x + L8w) + ' ' + loopC + '" stroke="' + INK + '" stroke-width="1.5" fill="none" stroke-dasharray="5 4"/>';
s += '<path d="M' + L8x + ' ' + loopC + ' L' + (L9x + L9w) + ' ' + loopC + '" stroke="' + INK + '" stroke-width="1.5" fill="none" stroke-dasharray="5 4"/>';
s += '<path d="M' + L9x + ' ' + loopC + ' L' + (b1 + bw / 2) + ' ' + loopC + ' L' + (b1 + bw / 2) + ' ' + (r1y + r1h + 8) + '" stroke="' + INK + '" stroke-width="1.5" fill="none" stroke-dasharray="5 4"/>' +
  '<path d="M' + (b1 + bw / 2 - 4.5) + ' ' + (r1y + r1h + 8) + ' L' + (b1 + bw / 2) + ' ' + (r1y + r1h) + ' L' + (b1 + bw / 2 + 4.5) + ' ' + (r1y + r1h + 8) + ' Z" fill="' + INK + '"/>';

s += loopStep(L7x, loopY, L7w, loopH, '7', 'Gate recomputes every number');
s += loopStep(L8x, loopY, L8w, loopH, '8', 'Review queue \u2014 six items for a human');
s += loopStep(L9x, loopY, L9w, loopH, '9', 'Resolved \u2014 cash position updates');

s += '<text x="' + (W / 2) + '" y="' + (loopY + loopH + 44) + '" font-family="' + F + '" font-size="14.5" font-weight="500" fill="' + SUB + '" text-anchor="middle">Nothing is applied that the rules could not prove or a human did not approve.</text>';

s += '<text x="52" y="732" font-family="' + F + '" font-size="13.5" font-weight="600" fill="' + SUB + '">11,269 records  \u00B7  100% precision  \u00B7  0 false matches  \u00B7  98.6% matched  \u00B7  ~116,000 records/sec on the rules alone</text>';

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' + s + '</svg>';
fs.writeFileSync(__dirname + '/flow.svg', svg);
sharp(Buffer.from(svg)).png().toFile(__dirname + '/magpie-flow.png')
  .then(i => console.log('OK', i.width + 'x' + i.height))
  .catch(e => console.error('ERR', e.message));
