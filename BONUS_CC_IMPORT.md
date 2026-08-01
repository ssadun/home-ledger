# Garanti Bonus Kredi Kartı Import Planı

## Amaç

Garanti Bonus kredi ve debit kart importlarında kategori eşleşmesini aşağıdaki sırayla güvenilir ve deterministik hâle getirmek:

1. Özel ve kesin işlem kuralları
2. Ekstredeki `Etiket` ve işlem açıklamasındaki bütün uygun mapping adayları arasında `priority`, keyword uzunluğu ve mapping `id` sırası
3. Eşleşme yoksa kredi/debit kart giderleri için `Shopping`

Bu kapsam hem tam Bonus ekstre PDF'lerini hem de bağımsız indirilebilen “Dönemiçi İşlemler” PDF'lerini içerir.

## Mevcut Durum ve Bulgular

- Backend, `Etiket` varsa `Statement Value Mapping` ile exact eşleşme yapıyor.
- `Etiket` yoksa aynı mapping anahtarlarını işlem açıklamasında contains aramasıyla kullanıyor.
- `Etiket` dolu fakat mapping bulunamazsa açıklama aramasına devam edilmiyor.
- “Dönemiçi İşlemler” parserı gerçek `Etiket` kolonunu okuyabiliyor.
- Tam Bonus ekstre parserı `Akaryakıt`, `Cafe & Restaurant`, `Süpermarket`, `Fast Food` gibi bölüm başlıklarını atlıyor.
- Kredi kartına özel confirm endpoint'i `default_category_key="shopping"` kullanıyor; ancak genel import wizardı işlemleri önce `/api/import/confirm` üzerinden kaydettiği için bu varsayılan ana akışta uygulanmıyor.
- Frontend'in eski `guessCategory()` fallback'i eşleşmeyen satırları `Wire Transfer` yapabiliyor. Bu nedenle sıradan kredi kartı harcamaları yanlış kategorilenebiliyor.

Örnek dosyalarda yapılan mevcut parser ölçümü:

- Altı tam Bonus ekstrede 529 işlemin 498'i backend önizlemesinde kategorisiz kalıyor.
- İki “Dönemiçi İşlemler” dosyasında toplam 79 işlemin 65'i mevcut `Etiket` mekanizmasıyla sınıflanıyor.

Ana kazanım tam ekstre bölüm başlıklarını işlemlere taşımak ve kalan kart giderlerine doğru varsayılanı uygulamak olacaktır.

## Nihai Eşleşme Önceliği

İlk başarılı kural kazanır:

1. Özel semantik kurallar:
   - Kart ödemesi
   - Önceki dönemden devir
   - Virman
   - Kesinti ve ekleri
   - `G.E. <sözleşme numarası>` BES ödemesi
2. Yapılandırılmış `Etiket`/bölüm başlığı exact eşleşmeleri ile açıklama merchant/keyword eşleşmelerinin ortak öncelik sırası
3. İşlem gider ve bağlı hesap `credit` veya `debit` ise `Shopping`
4. Diğer hesap türlerinin mevcut fallback davranışı

Etiket ve açıklama adayları birlikte sıralanır. Böylece geniş bir `Cafe & Restaurant → Dining` bölüm etiketi `priority=100` iken daha özel bir `SBX → Food & Beverage` açıklama kuralı `priority=200` ile onu geçebilir. Düşük sayı daha düşük önceliktir.

“Önce Shopping ata, bulunan mapping ile üzerine yaz” yaklaşımı sonuç olarak aynı olsa da yukarıdaki sıra uygulamada daha açık, izlenebilir ve test edilebilirdir.

## 1. Mapping Motorunu Birleştirme

`backend/app/services/bank_import.py` içindeki mapping yükleme ve arama akışı tek bir kural motorunda toplanacak.

- Virgülle ayrılan mevcut alias yapısı korunacak.
- `Etiket` exact eşleşmesi ve açıklama keyword eşleşmeleri birlikte aday olarak değerlendirilecek.
- Bütün mapping değerleri, etiketler, bölüm başlıkları ve açıklamalar aynı Türkçe-güvenli küçük-harfli kanonikleştirme fonksiyonundan geçirilecek.
- Noktalama, `/`, `*`, tire ve fazla boşluklar eşleşmeyi bozmayacak.
- Veritabanına kaydedilen özgün işlem açıklaması değiştirilmeyecek; normalizasyon yalnızca eşleşme için oluşturulan kopyaya uygulanacak.
- Eşleşmeler veritabanının tesadüfi satır sırasına bırakılmayacak.

### Küçük-harfli kanonik arama anahtarı

Yalnızca standart `lower()` kullanmak yeterli değildir. Özellikle Türkçedeki `I`, `İ`, `ı` ve `i` karakterleri farklı ortamlarda farklı sonuç verebilir. Bu nedenle dönüşüm sırası açıkça sabitlenecek:

1. Unicode metin normalize edilecek.
2. Türkçe karakterler kanonik Latin karşılıklarına çevrilecek.
3. Metin küçük harfe çevrilecek.
4. Arama türüne göre noktalama ve boşluklar kaldırılacak veya tek boşluğa indirgenecek.

Temel karakter dönüşümleri:

| Girdi | Kanonik değer |
|---|---|
| `I`, `İ`, `ı`, `i` | `i` |
| `Ş`, `ş` | `s` |
| `Ğ`, `ğ` | `g` |
| `Ü`, `ü` | `u` |
| `Ö`, `ö` | `o` |
| `Ç`, `ç` | `c` |

Örnekler:

| Ham değer | Kanonik arama anahtarı |
|---|---|
| `Eğlence / Hobi` | `eglencehobi` |
| `Sağlık / Bakım` | `saglikbakim` |
| `Kişisel Hizmet` | `kisiselhizmet` |
| `DİĞER HARCAMALARINIZ` | `digerharcamalariniz` |
| `MİGROS` | `migros` |
| `kırtasiye` | `kirtasiye` |

Kanonikleştirme harf ve yazım varyasyonlarını çözer; farklı kelime yapılarını kendi başına eşit yapmaz. Örneğin `Eğlence` → `eglence`, `Eğlence / Hobi` → `eglencehobi` olur ve exact eşleşmez. Bu tür değerler açık alias olarak tanımlanmalı veya yalnızca uygun `description` kurallarında kontrollü contains eşleşmesi kullanılmalıdır.

Deterministik sıralama:

1. Yüksek `priority`
2. Daha uzun normalize edilmiş keyword
3. Daha düşük mapping `id`

Böylece örneğin `PARIBUCINEVERSE` gibi belirgin bir kural, daha kısa ve genel bir kuraldan önce kazanır.

## 2. Statement Value Mapping Yapısını Genişletme

Mevcut `statement_mappings` tablosu korunacak. Aşağıdaki alanların eklenmesi önerilir:

| Alan | Tip | Varsayılan | Amaç |
|---|---|---|---|
| `match_scope` | String | `both` | `tag`, `description` veya `both` |
| `priority` | Integer | `100` | Çakışan kurallarda değerlendirme sırası |
| `is_active` | Boolean | `true` | Kuralı silmeden devre dışı bırakma |

Mevcut kayıtlar `both / 100 / true` olarak taşınacak.

Configuration → Statement Value Mapping ekranına şu alanlar eklenecek:

- Applies To
- Priority
- Active

### Çoklu keyword saklama kararı

Aynı kategori, kapsam ve priority değerine sahip yakın alias'lar Configuration ekranında tek mapping satırında, virgülle ayrılmış biçimde tutulacak. Örneğin:

| Statement Tag / Keywords | Kategori | Kapsam | Priority |
|---|---|---|---:|
| `Yeme / İçme, Cafe & Restaurant, Fast Food, Pastane` | Dining | Tag | 100 |
| `SBX, SBUX, STARBUCKS` | Dining | Description | 200 |
| `PARIBUCINEVERSE, PASSO` | Entertainment | Description | 200 |

Import başında her satırdaki alias'lar ayrıştırılıp ayrı küçük-harfli kanonik arama terimlerine açılacak:

```text
"SBX, SBUX, STARBUCKS" → sbx, sbux, starbucks
```

Böylece DB ve Configuration ekranı sade kalırken runtime araması tek-keyword-per-rule gibi çalışır. Performansı belirleyen DB satırı sayısı değil toplam ayrıştırılmış keyword sayısıdır.

Farklı kategoriye, `match_scope` değerine veya priority'ye sahip keyword'ler aynı satırda birleştirilmeyecek. Create/update sırasında küçük-harfli kanonik alias çakışmaları kontrol edilip anlaşılır bir `409` hatası döndürülmelidir. Örneğin `MİGROS` ile `migros` aynı `migros` anahtarına dönüştüğü için mükerrer sayılacaktır.

İleride her keyword için ayrı istatistik, indeks veya yönetim ihtiyacı oluşursa kullanıcı arayüzü aynı kalacak şekilde normalize edilmiş bir child tabloya geçilebilir:

```text
statement_mappings
  id, category_key, match_scope, priority, is_active

statement_mapping_terms
  id, mapping_id, value, normalized_value
```

Bu parent-child yapı ilk sürüm için performans gereksinimi değildir; uzun vadeli veri bütünlüğü seçeneğidir.

İleride ihtiyaç oluşursa kurallara `institution_key` veya `account_type` kapsamı eklenebilir. İlk sürüm için zorunlu değildir.

## 3. Tam Bonus Ekstre Bölüm Başlıklarını Taşıma

`_parse_garanti_cc_pdf()` içinde bir `active_section_tag` tutulacak.

- Yeni kategori başlığı görüldüğünde aktif etiket güncellenecek.
- Sonraki işlem satırlarına `etiket=active_section_tag` aktarılacak.
- Etiket yeni kategori başlığına veya yeni kart/tablo bölümüne kadar geçerli olacak.
- Sayfa başlığı, kolon başlığı, açıklama metni ve footer gibi içeriklerin kategori sanılmaması için Garanti ekstre yapısına özgü korumalar uygulanacak.
- İşlem adedi, tutar, tarih, açıklama ve kart kimliği parsing davranışı değişmeyecek.

Örnek bölüm başlıkları:

- Akaryakıt
- Cafe & Restaurant
- Süpermarket
- Fast Food
- Eğlence
- Pastane
- Bilgisayar
- Eczane
- Kozmetik
- Sağlık
- Ulaşım
- DİĞER HARCAMALARINIZ
- YURT DIŞI HARCAMALARINIZ

`DİĞER HARCAMALARINIZ` ve `YURT DIŞI HARCAMALARINIZ` gibi genel bölümler mapping bulamazsa açıklama keyword'üne, o da bulunamazsa kart varsayılanı `Shopping` kategorisine düşecek.

“Dönemiçi İşlemler” parserı gerçek `Etiket` kolonunu okumaya devam edecek ve aynı merkezi eşleşme motorunu kullanacak.

## 4. Başlangıç Mapping Kayıtları

Başlangıç için aşağıdaki alias'lar değerlendirilecek:

| Statement tag / keyword | Kategori |
|---|---|
| `Cafe & Restaurant, Yeme / İçme, Fast Food, Pastane, SBX, SBUX` | Dining |
| `Süpermarket, Market` | Groceries |
| `Akaryakıt` | Mevcut yapılandırmadaki Fuel/Transport tercihi |
| `Eğlence, Eğlence / Hobi, PARIBUCINEVERSE, PASSO` | Entertainment |
| `Elektronik, Bilgisayar, ARÇELİK` | Shopping |

Seed/backfill işlemi kullanıcının mevcut değiştirilmiş mapping kayıtlarının kategori seçimini ezmemeli. Yeni alias ekleme işlemi idempotent olmalı.

## 5. Kredi ve Debit Kart Shopping Varsayılanı

Genel `/api/import/confirm` akışında satırların `payment_method` değerlerinden kullanıcının hesapları tek sorguyla yüklenecek.

Aşağıdaki koşullar birlikte sağlandığında backend son otorite olarak `category_key="shopping"` atayacak:

- İlişkili hesap kullanıcıya ait.
- Hesap tipi `credit` veya `debit`.
- İşlem tipi `expense`.
- Özel kural, etiket veya açıklama keyword eşleşmesi bulunamamış.

Bu varsayılan:

- Gelir/iade işlemlerine uygulanmayacak.
- Kart ödeme satırlarına uygulanmayacak.
- BES, virman ve kesinti gibi özel kuralları ezmeyecek.
- Banka hesabı importlarının mevcut fallback davranışını değiştirmeyecek.

Aynı sonuç review ekranında da gösterilmeli. Kullanıcı önizlemede `Wire Transfer`, kayıt sonrasında `Shopping` gibi farklı sonuçlar görmemeli.

Frontend `guessCategory()` fonksiyonu hesap türünü dikkate alacak şekilde düzenlenecek veya backend'in döndürdüğü sonuç bulunmadığında hesap tipine göre uygun fallback uygulanacak.

## 6. Test Planı

Golden fixture kapsamına şu sekiz dosyanın tamamı alınacak:

- `26.01-BonusCardEkstre.pdf`
- `26.02-BonusCardEkstre.pdf`
- `26.03-BonusCardEkstre.pdf`
- `26.04-BonusCardEkstre.pdf`
- `26.05-BonusCardEkstre.pdf`
- `26.06-BonusCardEkstre.pdf`
- `26.07-Donemici Islemler - TL.pdf`
- `garanti-bonus-Donemici Islemler - TL.pdf`

### Parser regresyonları

- Mevcut satır adetleri değişmemeli.
- Gelir/gider toplamları değişmemeli.
- Tarih aralıkları değişmemeli.
- Açıklamaların özgün yazımı korunmalı.
- Kart kimliği, son ödeme tarihi ve dönem toplamı parsing davranışı korunmalı.

### Kategori testleri

- Tam ekstre bölüm etiketi doğru işlem satırlarına taşınmalı.
- `ARÇELİK`, `SBX`, `PARIBUCINEVERSE` ve `PASSO` hedef kategorilere gitmeli.
- `I`, `İ`, `ı` ve `i` ile yazılmış eşdeğer örneklerin tamamı aynı küçük-harfli anahtara dönüşmeli.
- `Eğlence`, `EĞLENCE` ve `eğlence`; `Sağlık`, `SAĞLIK` ve `sağlık` aynı kanonik değeri üretmeli.
- Noktalama ve boşluk varyasyonları aynı sonucu vermeli: `Yeme / İçme`, `Yeme/İçme` ve `Yeme İçme`.
- Aynı satırdaki virgülle ayrılmış her alias bağımsız bir arama terimi olarak çalışmalı.
- Kanonik olarak aynı alias'ın ikinci kez kaydedilmesi engellenmeli.
- Daha yüksek priority değerli açıklama eşleşmesi, daha düşük priority değerli yapılandırılmış etiketi geçebilmeli.
- Daha yüksek priority değerli yapılandırılmış etiket, daha düşük priority değerli açıklama eşleşmesini geçebilmeli.
- Etiket dolu fakat eşleşmiyorsa açıklama araması çalışmalı.
- Aynı priority'de en uzun keyword kazanmalı.
- Özel kurallar mapping tarafından ezilmemeli.
- Eşleşmeyen credit/debit gideri `Shopping` olmalı.
- Eşleşmeyen credit/debit gelirine `Shopping` atanmamalı.
- Banka hesabı fallback davranışı değişmemeli.
- Hesap çözümleme owner-scoped olmalı.

### Doğrulama

- Backend testleri `CLAUDE.md` içinde belgelenen Docker yöntemiyle çalıştırılmalı.
- Hedefli parser testlerinden sonra tüm backend test paketi çalıştırılmalı.
- Configuration alanları değişirse masaüstü ve 360 px gerçek tarayıcı kontrolü yapılmalı.
- Import review ekranında kategori değerleri gerçek dosyalarla doğrulanmalı.
- `git diff --check` çalıştırılmalı.

## 7. SQLite ve Performans Kararı

Bu sistemin kişisel/aile finansı ölçeğinde çalışması nedeniyle MariaDB veya PostgreSQL'e geçiş önerilmez.

Mapping kayıtları import başlangıcında bir kez belleğe alınır; her işlem için veritabanı sorgusu yapılmaz. Örneğin 200 kural ve 1.000 işlem yaklaşık 200.000 basit string karşılaştırması üretir ve bu ölçek için ihmal edilebilir.

Tek DB satırında virgülle çoklu alias ile her keyword'ü ayrı DB satırında tutmak arasında import performansı açısından anlamlı fark yoktur. Her iki yaklaşım da belleğe yüklenirken aynı düz kanonik keyword listesine dönüşür. Bu proje için aynı özelliklere sahip alias'ları tek mapping satırında gruplamak daha kullanışlıdır.

Normal B-tree indeksleri `%keyword%` biçimindeki contains aramasını hızlandırmaz. Bu nedenle doğru optimizasyon şunlardır:

- Kuralları bir kez belleğe almak
- Küçük-harfli kanonik değerleri yükleme sırasında bir kez hesaplamak
- Virgülle ayrılmış alias'ları bellekte ayrı arama terimlerine açmak
- Deterministik priority sırası kullanmak
- Hesapları confirm sırasında satır başına değil tek sorguyla yüklemek

`(lang, is_active, priority, id)` bileşik indeksi kural listesinin yüklenmesine yardımcı olabilir fakat mevcut ölçek için zorunlu değildir. `id` dışında substring aramasını doğrudan hızlandıracak klasik bir indeks bulunmamaktadır.

Çok daha büyük bir ölçek oluşursa önce SQLite FTS5 veya çoklu-pattern arama algoritmaları değerlendirilmelidir. Yalnızca bu özellik için veritabanı motoru taşımak gereksiz operasyonel yük getirir.

## 8. Eşleşme Oranını Artırma Önerileri

### Eşleşme kaynağını görünür yapmak

Preview satırlarına aşağıdaki tanılama alanları eklenebilir:

- `category_source`: `special`, `statement-tag`, `description-keyword`, `card-default`
- `mapping_id`
- `matched_value`

Bu alanların transaction tablosunda kalıcı tutulması ilk sürüm için zorunlu değildir.

### Review düzeltmelerinden kural üretmek

Kullanıcı review ekranında kategoriyi değiştirdiğinde isteğe bağlı olarak:

- “Bu açıklamadan mapping oluştur”
- “Bu merchant için her zaman kullan”

aksiyonları sunulabilir.

### Eşleşmeyen merchant raporu

Eşleşmeyen açıklamalar normalize merchant adına göre gruplanıp kullanım sıklığıyla listelenebilir. En sık tekrarlanan merchant'lar önce yapılandırılarak eşleşme oranı hızla artırılabilir.

### Gürültü temizliği

Eşleşme için kullanılan geçici metinden aşağıdaki parçalar temizlenebilir:

- `MOBİL:`
- `IYZICO/`
- Taksit eki `(7/9)`
- Fazla boşluk ve noktalama

Özgün açıklama saklanmaya devam etmelidir.

### Kısa keyword güvenliği

`SBX` gibi kısa keyword'ler bağımsız token sınırlarıyla aranmalıdır. Bu, kısa bir anahtarın daha uzun ve ilgisiz bir kelimenin içinde yanlış eşleşmesini engeller.

## Kabul Kriterleri

- Sekiz örnek PDF kayıpsız parse edilir.
- Tam Bonus ekstrelerde kategori başlığı sonraki işlemlere doğru taşınır.
- Dönemiçi dosyalardaki gerçek `Etiket` kolonu exact eşleşme adayı olarak kullanılır.
- Bütün etiket, mapping ve açıklama aramaları Türkçe `I/İ/ı/i` güvenli küçük-harfli kanonik anahtarlarla yapılır.
- Aynı mapping satırındaki virgülle ayrılmış alias'lar runtime'da ayrı arama terimleri olarak değerlendirilir.
- Etiket ve açıklama eşleşmeleri ortak priority sırasına girer.
- İlk eşleşme priority, keyword uzunluğu ve mapping id değerine göre deterministiktir.
- Eşleşmeyen kredi/debit kart giderleri `Shopping` olur.
- Özel işlem kuralları ve banka hesabı davranışları bozulmaz.
- Önizleme ile kaydedilen kategori birbirinden farklı olmaz.
- SQLite üzerinde satır başına DB sorgusu veya `%keyword%` SQL taraması yapılmaz.
