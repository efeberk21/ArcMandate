# ArcMandate kod incelemesi — 2 Ekim 2026

Bu belge `contracts/src`, `packages/core/src`, `apps/web/src`, `scripts` ve mevcut testleri kaynak koduyla yeniden karşılaştırır. Statik inceleme ve yerel test sonucu bir güvenlik denetimi (audit) değildir. Önceki 30 Eylül metnindeki puanlar, “mükemmel/kanıtlanmış” gibi değerlendirmeler ve çalıştırılmamış test iddiaları çıkarıldı.

## Doğrulanan bulgular

| Konu | Kaynakta görülen durum | Karar |
|---|---|---|
| `remainingBudget()` underflow | `spent` yalnız `agentPay` içinde bütçe kontrolünden sonra artıyor; `_clearPolicy()` iki değeri de sıfırlıyor. | Hata yok. Inactive durumda `0` dönmesi mevcut sözleşme anlamıyla tutarlı. |
| Sıfır adresli alıcı | `_validatePolicy` ilk alıcıyı başlangıçtaki sıfır adresten **büyük** olmaya zorluyor. | Hata yok. Açıklayıcı yorum isteğe bağlı; güvenlik düzeltmesi gerektirmiyor. |
| Session replace ve freeze sayaçları | `startSession` replace sırasında `sessionId` ve `controlNonce` değerlerini birer kez artırıyor; `SessionRevoked` önce yayımlanıyor. | Planla uyumlu. |
| Withdraw nonce sırası | `controlNonce` transferden önce artıyor; transfer revert ederse EVM state'i geri alıyor. | Planla uyumlu. |
| Expiry sınırı | `block.timestamp >= expiresAt/deadline` reddediliyor. | Planla uyumlu. |
| Eski mapping girdileri | Mapping'ler silinmiyor, session ID ile ayrılıyor; mevcut alıcı dizisi temizleniyor. | Bilinçli tasarım, erişim izolasyonu testli. |
| PQ verifier | İmza uzunluğu, `staticcall` başarısı, 32 bayt yanıt ve tam `1` kontrol ediliyor. | Fail-closed davranış birim testleriyle doğrulanmış; gerçek ağ kapsamı belirli Arc testnet işlemleriyle sınırlı. |
| Demo ödeme tekrar denemesi | Eski `testnet-demo.ts` transaction gönderdikten sonra hash kaydetmeden kesilebiliyordu ve ödeme ID'sini etiketten türetiyordu. | P5 kapsamında agent ödemesi için rastgele ID ve gönderim öncesi kalıcı imzalı işlem/hash journal'ı eklendi. Diğer demo adımlarının aynı dayanıklılık düzeyi ayrıca izlenmeli. |

## Önceki incelemedeki somut düzeltmeler

- Vault **16** custom error tanımlıyor; önceki “14” sayısı yanlıştı.
- `TransactionState.stage` **14** farklı değer içeriyor; metindeki “8 durum” ve aynı belgedeki “13 durum” birbiriyle de çelişiyordu.
- `App.tsx` 30 Eylül sürümünde yaklaşık 393 satır. Bölme önerisi bakım işi; doğrulanmış bir işlevsel hata değil. Basit bir mutex sınıfının mevcut `running` korumasından daha güvenli olduğu gösterilmedi.
- 620.232 gas × 25 gwei = **0,0155058 native USDC** (Arc'ın 18 ondalıklı gas birimi); önceki `0,0000155` hesabı 1000 kat düşüktü. Bu geçmiş testnet fiili gas fiyatıdır, güncel/mainnet maliyet tahmini değildir. Vault'a aktarılan 6 ondalıklı ERC20 USDC ile gas birimi karıştırılmamalı.
- Dosyanın önceki “18 Foundry” sayısı doğruydu; TypeScript test sayısı P4 için 13 idi. P5 journal testleriyle sayı değişir; sabit sayıyı güncel test çıktısından raporlamak gerekir.
- `scrypt`, AES-GCM ve Worker bellek sıfırlaması uygulanan önlemlerdir. JavaScript belleğinin kesin silindiği veya kriptografik bileşenlerin kapsamlı denetlendiği sonucunu vermezler.
- Mempool sıralaması agent ödemesini engelleyebilir veya session freeze ondan önce dahil edilebilir. `paymentId` çift **başarılı ödemeyi** engeller; işlem sansürü, başarısızlık veya hizmet teslimini çözmez.

## Açık işler ve öncelik

1. **P5 tamamlandı:** Testnet prova ve CLI restart kontrolü `deployments/arc-testnet-p5.json` ile doğrulandı. RPC timeout'u receipt yokluğu demek değildir; önce receipt ve `usedPaymentIds` kontrolü yapılır. Kullanılmış ID için `AgentPaid` event'i/receipt aranır. Yeni session'a otomatik geçilmez.
2. **P6:** T10 tam alan mutasyon matrisi, stateful fuzz/invariant testleri, clean checkout, gerçek wallet extension ve OS dosya seçici testi eksik. P4 browser smoke yerel development adapter ile yapıldı.
3. **P6/P7:** Mainnet öncesi mevcut fee ile maliyet hesabı ve explorer source verification gerçek başarı olarak kaydedilmeli.

## Sınır

Mevcut olumlu testler test edilen yolları gösterir; bütün input, RPC, wallet ve zincir koşullarını kapsamaz. Testnet'teki başarılı PQ işlemleri mainnet uyumluluğu veya audit yerine geçmez. `docs/IMPLEMENTATION-STATUS.md` hangi paketin gerçekten tamamlandığı ve hangi kanıtın bulunduğu için güncel kayıt olarak kullanılmalıdır.
