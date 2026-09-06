module.exports = async function afterSign(context) {
  const hasCertificate = Boolean(process.env.CSC_LINK || process.env.WIN_CSC_LINK);
  if (!hasCertificate) {
    console.log("[signing] No certificate configured. Skipping code-sign hook.");
    return;
  }
  console.log(`[signing] Signed build ready for ${context.appOutDir}`);
};
