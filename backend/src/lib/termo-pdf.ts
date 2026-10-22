const winAnsi: Record<string, number> = {
  á: 0xe1, à: 0xe0, ã: 0xe3, â: 0xe2, é: 0xe9, ê: 0xea, í: 0xed,
  ó: 0xf3, õ: 0xf5, ô: 0xf4, ú: 0xfa, ç: 0xe7,
  Á: 0xc1, À: 0xc0, Ã: 0xc3, Â: 0xc2, É: 0xc9, Ê: 0xca, Í: 0xcd,
  Ó: 0xd3, Õ: 0xd5, Ô: 0xd4, Ú: 0xda, Ç: 0xc7,
};

function pdfText(value: string): string {
  let out = "";
  for (const char of value) {
    if (char === "\\" || char === "(" || char === ")") out += `\\${char}`;
    else if (winAnsi[char] != null) out += `\\${winAnsi[char].toString(8).padStart(3, "0")}`;
    else if (char.charCodeAt(0) < 128 && char !== "\n" && char !== "\r") out += char;
    else out += " ";
  }
  return out;
}

export function buildTermoPdf(lines: string[]): Buffer {
  const commands = ["BT", "/F1 11 Tf", "48 790 Td", "16 TL"];
  for (const line of lines) commands.push(`(${pdfText(line)}) Tj`, "T*");
  commands.push("ET");
  const stream = commands.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefAt = Buffer.byteLength(body);
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index < offsets.length; index += 1) {
    xref += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  body += `${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  return Buffer.from(body, "latin1");
}
