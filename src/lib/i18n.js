/**
 * Lightweight internationalisation for the customizer.
 *
 * The active language is auto-detected from (in priority order):
 *   1. `window.CharmeConfig.locale` — forwarded by the Shopify drop-in snippet
 *      from the storefront's `request.locale` / `localization.language`.
 *   2. `window.Shopify.locale` — injected by the theme.
 *   3. `<html lang>` on the host page.
 *   4. `navigator.language`.
 * It is normalised to one of the dictionary keys below (region-agnostic, e.g.
 * `zh-CN` → `zh`); anything we don't ship a table for falls back to English.
 *
 * Strings support `{name}` interpolation. `tn(key, n, params)` picks the
 * singular/plural variant (`key` / `key`+`_plural`) for count-sensitive copy.
 */

const SUPPORTED = ['en', 'zh', 'fr', 'de', 'es', 'ja']

function rawLocale() {
  if (typeof window === 'undefined') return 'en'
  const cfg = window.CharmeConfig && window.CharmeConfig.locale
  if (cfg) return String(cfg)
  if (window.Shopify && window.Shopify.locale) return String(window.Shopify.locale)
  const htmlLang =
    typeof document !== 'undefined' &&
    document.documentElement &&
    document.documentElement.getAttribute('lang')
  if (htmlLang) return String(htmlLang)
  if (window.navigator && window.navigator.language) return String(window.navigator.language)
  return 'en'
}

/** The full BCP-47 locale (e.g. 'fr-CA', 'zh-CN') for Intl formatting. */
export function currentLocale() {
  return rawLocale()
}

/** The dictionary key for the active language (e.g. 'zh', 'fr'), default 'en'. */
export function currentLang() {
  const base = rawLocale().toLowerCase().split('-')[0]
  return SUPPORTED.includes(base) ? base : 'en'
}

// ---------------------------------------------------------------------------
// Translation tables. `en` is the complete source of truth; the other languages
// translate the customer-visible strings and fall back to `en` for any missing
// key (so partial translations degrade gracefully rather than showing a blank).
// ---------------------------------------------------------------------------
const DICT = {
  en: {
    // Charm tray
    'charm.unavailable': 'Unavailable',
    'charm.tip.unavailable': 'Currently unavailable',
    'charm.tip.scatter': 'Tap to scatter into the gaps',
    'charm.tip.tapAdd': 'Tap to add — then drag it on your case',
    'charm.tip.dragAdd': 'Drag onto your piece — or click to add',
    'charm.typeWord': 'Type a word or number',
    'charm.add': 'Add',
    'charm.position': 'Position',
    'charm.position.top': 'Top',
    'charm.position.middle': 'Middle',
    'charm.position.bottom': 'Bottom',
    'charm.arch': 'Arch',
    'charm.empty': 'No charms in this category yet.',
    'charm.wordPlaceholder': 'e.g. EMMA 24',
    'charm.wordHint': 'Mix letters & numbers, up to 14 characters.',
    'charm.yourWords': 'Your words:',
    'charm.selectWord': 'Select this word to move it as one',

    // Nouns (product kind)
    'noun.case': 'case',
    'noun.tote': 'tote',
    'noun.frame': 'frame',

    // Price bar / order
    'price.ready': 'Ready to order',
    'price.addAtLeast': 'Add at least {n} charms',
    'price.useAtMost': 'Use at most {n} charms',
    'price.needAttention': '{n} charm needs attention',
    'price.needAttention_plural': '{n} charms need attention',
    'price.charmCount': '{n} charm',
    'price.charmCount_plural': '{n} charms',
    'price.aimFor': ' · aim for {min}–{max}',
    'price.base': '{name} base · {price}',
    'price.plusCharms': '+ charms {price}',
    'price.estimatedTotal': 'Estimated total',
    'price.total': 'Total',
    'price.orderSummary': 'Order summary',
    'cta.addToCart': 'Add my custom {noun} to cart ({price})',
    'cta.addSecondProduct': 'Add second product to cart ({price})',

    // Product picker
    'picker.step1': 'Step 1 · Choose your base',
    'picker.caseColour': 'Case colour',
    'picker.gelColour': 'Gel colour',
    'picker.colour': 'Colour',
    'picker.model': 'Model',
    'picker.availableNow': 'Available now',
    'picker.comingSoon': 'Coming soon',

    // Summary / preview
    'summary.previewAlt': 'Your design preview',
    'summary.indicative': 'Charms outlined in red are indicative.',
    'summary.fillerNote': ' Filler charms are arranged by hand.',
    'summary.download': 'Download',

    // Toast / validation messages
    'msg.maxCharms': 'You can add up to {n} charms.',
    'msg.bundleIncluded': 'Up to {n} “{name}” are included for one price.',
    'msg.charsUnavailable': 'Those characters aren’t available as charms.',
    'msg.skipped': 'Skipped (no charm): {chars}',
    'msg.addAtLeastHave': 'Please add at least {min} charms before ordering — you have {have}.',
    'msg.useAtMost': 'Please use at most {n} charms.',

    // Generic actions
    'action.undo': 'Undo',
    'action.clear': 'Clear',
    'action.back': 'Back',
    'action.done': 'Done',
    'action.close': 'Close',
    'action.cancel': 'Cancel',
    'action.zoomIn': 'Zoom in',
    'action.zoomOut': 'Zoom out',
    'action.clearAll': 'Clear all',
    'action.dismiss': 'Dismiss',
    'action.rotate': 'Drag to rotate in either direction',

    'step1.mobile': 'Step 1: Select Model',
    'label.case': 'Case',
    'label.gel': 'Gel',
    'step2.mobileTitle': 'Step 2: Add charms',
    'step2.mobileHint': 'Tap to add charms. Once added, you can move the charms around the case and rotate them.',
    'step2.desktopTitle': 'Step 2 · Add your charms',
    'step2.recommend': 'We recommend {min}–{max} charms for a balanced look.',
    'step2.added': ' {n} added.',
    'step2.desktopHint': 'We recommend {min}–{max} charms for a balanced look. Minimum {min2} charms required.',
    'notice.mockup': 'This tool is for charms mock-up only, gel will be added during production.',
    'notice.mockupShort': 'Mock-up only',
    'pricing.groupNotice': 'Price is for {n} items — select {n} items.',
    'charms.label': 'Charms',
    'charms.selected': '{n} selected',
    'charms.shrink': 'Shrink charm picker',
    'charms.enlarge': 'Enlarge charm picker',
    'alert.overlap': 'Some charms are overlapping or placed outside the craftable area. Please nudge the highlighted charms apart until the outline clears.',
    'aria.splitter': 'Drag to resize the preview and charm tray',
    'aria.trayResizer': 'Drag to resize the charm tray',
    'hint.widen': 'The window is too narrow to show the charms — widen it or zoom out to see them all.',
    'crossSell.title': 'Would you like to customise your second product?',
    'crossSell.body': 'Buy two cases, get a phone strap for free',
    'crossSell.noThanks': 'No thanks — go to my cart →',
    'tips.title': 'How it works',
    'tips.1': 'Choose your phone model & preferred gel.',
    'tips.2': 'Browse charms by Gold, Silver, Colourful & Natural.',
    'tips.3': 'Drag or tap a charm to add it to your case.',
    'tips.4': 'Tap a charm on the case to rotate or remove it.',
    'tips.5': 'If a charm is highlighted, it’s overlapping or outside the case — simply adjust it before ordering. (Minimum 10 charms required)',
    'tips.6': 'Order your bespoke phone case, we will bring it to life.',
    'group.moveOnOwn': 'Move letters on their own?',
    'group.yes': 'Yes',
    'group.no': 'No',
    'group.confirm': 'Confirm',
    'group.confirmTip': 'Lock this position, then edit each letter on its own',
    'action.remove': 'Remove',
  },

  zh: {
    'charm.unavailable': '暂不可用',
    'charm.tip.unavailable': '当前不可用',
    'charm.tip.scatter': '点击自动填充到空隙',
    'charm.tip.tapAdd': '点击添加 — 然后拖到你的壳子上',
    'charm.tip.dragAdd': '拖到你的作品上 — 或点击添加',
    'charm.typeWord': '输入文字或数字',
    'charm.add': '添加',
    'charm.position': '位置',
    'charm.position.top': '上',
    'charm.position.middle': '中',
    'charm.position.bottom': '下',
    'charm.arch': '弧形',
    'charm.empty': '此类别暂无挂饰。',
    'charm.wordPlaceholder': '例如 EMMA 24',
    'charm.wordHint': '可混合字母与数字，最多 14 个字符。',
    'charm.yourWords': '你的文字：',
    'charm.selectWord': '选中这个词以整体移动',

    'noun.case': '手机壳',
    'noun.tote': '帆布袋',
    'noun.frame': '相框',

    'price.ready': '可以下单',
    'price.addAtLeast': '至少添加 {n} 个挂饰',
    'price.useAtMost': '最多使用 {n} 个挂饰',
    'price.needAttention': '{n} 个挂饰需要调整',
    'price.needAttention_plural': '{n} 个挂饰需要调整',
    'price.charmCount': '{n} 个挂饰',
    'price.charmCount_plural': '{n} 个挂饰',
    'price.aimFor': ' · 建议 {min}–{max} 个',
    'price.base': '{name} 基础价 · {price}',
    'price.plusCharms': '+ 挂饰 {price}',
    'price.estimatedTotal': '预计总计',
    'price.total': '总计',
    'price.orderSummary': '订单摘要',
    'cta.addToCart': '将我的定制{noun}加入购物车（{price}）',
    'cta.addSecondProduct': '将第二件商品加入购物车（{price}）',

    'picker.step1': '第 1 步 · 选择你的基底',
    'picker.caseColour': '壳子颜色',
    'picker.gelColour': '凝胶颜色',
    'picker.colour': '颜色',
    'picker.model': '型号',
    'picker.availableNow': '现已推出',
    'picker.comingSoon': '即将推出',

    'summary.previewAlt': '你的设计预览',
    'summary.indicative': '红色轮廓的挂饰仅供示意。',
    'summary.fillerNote': ' 填充挂饰由手工排列。',
    'summary.download': '下载',

    'msg.maxCharms': '最多可添加 {n} 个挂饰。',
    'msg.bundleIncluded': '“{name}”最多 {n} 个按一个价格计。',
    'msg.charsUnavailable': '这些字符暂无对应挂饰。',
    'msg.skipped': '已跳过（无对应挂饰）：{chars}',
    'msg.addAtLeastHave': '下单前请至少添加 {min} 个挂饰 — 你目前有 {have} 个。',
    'msg.useAtMost': '最多使用 {n} 个挂饰。',

    'action.undo': '撤销',
    'action.clear': '清空',
    'action.back': '返回',
    'action.done': '完成',
    'action.close': '关闭',
    'action.cancel': '取消',
    'action.zoomIn': '放大',
    'action.zoomOut': '缩小',
    'action.clearAll': '全部清空',
    'action.dismiss': '关闭',

    'step1.mobile': '第 1 步：选择型号',
    'label.case': '壳子',
    'label.gel': '凝胶',
    'step2.mobileTitle': '第 2 步：添加挂饰',
    'step2.mobileHint': '点击添加挂饰。添加后可在壳子上移动和旋转。',
    'step2.desktopTitle': '第 2 步 · 添加你的挂饰',
    'step2.recommend': '建议 {min}–{max} 个挂饰以获得均衡外观。',
    'step2.added': ' 已添加 {n} 个。',
    'step2.desktopHint': '建议 {min}–{max} 个挂饰以获得均衡外观。至少需要 {min2} 个。',
    'charms.label': '挂饰',
    'charms.selected': '已选 {n} 个',
    'charms.shrink': '缩小挂饰选择器',
    'charms.enlarge': '放大挂饰选择器',
    'alert.overlap': '有挂饰重叠或超出可制作区域。请将高亮的挂饰稍微分开，直到轮廓消失。',
    'aria.splitter': '拖动以调整预览与挂饰栏的大小',
    'aria.trayResizer': '拖动以调整挂饰栏的大小',
    'hint.widen': '窗口太窄，无法显示全部挂饰 — 请把窗口拉宽或缩小页面查看全部。',
    'crossSell.title': '再定制一件产品？',
    'crossSell.body': '已加入购物车！继续设计 — 选择你的下一件产品：',
    'crossSell.noThanks': '不用了 — 前往购物车 →',
    'tips.title': '使用说明',
    'tips.1': '选择你的手机型号和喜欢的凝胶。',
    'tips.2': '按金色、银色、彩色与自然材质浏览挂饰。',
    'tips.3': '拖动或点击挂饰即可添加到你的壳子上。',
    'tips.4': '点击壳子上的挂饰即可旋转或删除。',
    'tips.5': '如果挂饰被高亮，说明它重叠或超出了壳子范围 — 下单前请稍作调整。（至少需要 10 个挂饰）',
    'tips.6': '下单定制你的专属手机壳，我们将为你实现。',
    'group.moveOnOwn': '让字母单独移动？',
    'group.yes': '是',
    'group.no': '否',
    'group.confirm': '确认',
    'group.confirmTip': '锁定此位置，然后单独编辑每个字母',
    'action.remove': '删除',
  },

  fr: {
    'charm.unavailable': 'Indisponible',
    'charm.tip.unavailable': 'Actuellement indisponible',
    'charm.tip.scatter': 'Touchez pour remplir les espaces',
    'charm.tip.tapAdd': 'Touchez pour ajouter — puis glissez sur votre coque',
    'charm.tip.dragAdd': 'Glissez sur votre pièce — ou cliquez pour ajouter',
    'charm.typeWord': 'Saisir un mot ou un nombre',
    'charm.add': 'Ajouter',
    'charm.position': 'Position',
    'charm.position.top': 'Haut',
    'charm.position.middle': 'Milieu',
    'charm.position.bottom': 'Bas',
    'charm.arch': 'Arc',
    'charm.empty': 'Aucune breloque dans cette catégorie.',
    'charm.wordPlaceholder': 'ex. EMMA 24',
    'charm.wordHint': 'Mélangez lettres et chiffres, jusqu’à 14 caractères.',
    'charm.yourWords': 'Vos mots :',
    'charm.selectWord': 'Sélectionnez ce mot pour le déplacer d’un bloc',

    'noun.case': 'coque',
    'noun.tote': 'sac',
    'noun.frame': 'cadre',

    'price.ready': 'Prêt à commander',
    'price.addAtLeast': 'Ajoutez au moins {n} breloques',
    'price.useAtMost': 'Utilisez au plus {n} breloques',
    'price.needAttention': '{n} breloque à ajuster',
    'price.needAttention_plural': '{n} breloques à ajuster',
    'price.charmCount': '{n} breloque',
    'price.charmCount_plural': '{n} breloques',
    'price.aimFor': ' · visez {min}–{max}',
    'price.base': '{name} base · {price}',
    'price.plusCharms': '+ breloques {price}',
    'price.estimatedTotal': 'Total estimé',
    'price.total': 'Total',
    'price.orderSummary': 'Récapitulatif',
    'cta.addToCart': 'Ajouter mon {noun} personnalisé au panier ({price})',
    'cta.addSecondProduct': 'Ajouter le deuxième produit au panier ({price})',

    'picker.step1': 'Étape 1 · Choisissez votre base',
    'picker.caseColour': 'Couleur de la coque',
    'picker.gelColour': 'Couleur du gel',
    'picker.colour': 'Couleur',
    'picker.model': 'Modèle',
    'picker.availableNow': 'Disponible',
    'picker.comingSoon': 'Bientôt disponible',

    'summary.previewAlt': 'Aperçu de votre création',
    'summary.indicative': 'Les breloques entourées en rouge sont indicatives.',
    'summary.fillerNote': ' Les breloques de remplissage sont placées à la main.',
    'summary.download': 'Télécharger',

    'msg.maxCharms': 'Vous pouvez ajouter jusqu’à {n} breloques.',
    'msg.bundleIncluded': 'Jusqu’à {n} « {name} » sont incluses pour un seul prix.',
    'msg.charsUnavailable': 'Ces caractères ne sont pas disponibles en breloques.',
    'msg.skipped': 'Ignoré (aucune breloque) : {chars}',
    'msg.addAtLeastHave': 'Ajoutez au moins {min} breloques avant de commander — vous en avez {have}.',
    'msg.useAtMost': 'Utilisez au plus {n} breloques.',

    'action.undo': 'Annuler',
    'action.clear': 'Effacer',
    'action.back': 'Retour',
    'action.done': 'Terminé',
    'action.close': 'Fermer',
    'action.cancel': 'Annuler',
    'action.zoomIn': 'Zoom avant',
    'action.zoomOut': 'Zoom arrière',
    'action.clearAll': 'Tout effacer',
    'action.dismiss': 'Fermer',

    'step1.mobile': 'Étape 1 : Choisir le modèle',
    'label.case': 'Coque',
    'label.gel': 'Gel',
    'step2.mobileTitle': 'Étape 2 : Ajouter des breloques',
    'step2.mobileHint': 'Touchez pour ajouter des breloques. Ensuite, déplacez-les sur la coque et faites-les pivoter.',
    'step2.desktopTitle': 'Étape 2 · Ajoutez vos breloques',
    'step2.recommend': 'Nous recommandons {min}–{max} breloques pour un rendu équilibré.',
    'step2.added': ' {n} ajoutées.',
    'step2.desktopHint': 'Nous recommandons {min}–{max} breloques pour un rendu équilibré. Minimum {min2} breloques requis.',
    'charms.label': 'Breloques',
    'charms.selected': '{n} sélectionnées',
    'charms.shrink': 'Réduire le sélecteur',
    'charms.enlarge': 'Agrandir le sélecteur',
    'alert.overlap': 'Certaines breloques se chevauchent ou dépassent la zone réalisable. Écartez les breloques surlignées jusqu’à ce que le contour disparaisse.',
    'aria.splitter': 'Glissez pour redimensionner l’aperçu et le tiroir de breloques',
    'aria.trayResizer': 'Glissez pour redimensionner le tiroir de breloques',
    'hint.widen': 'La fenêtre est trop étroite pour afficher les breloques — élargissez-la ou dézoomez pour tout voir.',
    'crossSell.title': 'Personnaliser un deuxième produit ?',
    'crossSell.body': 'Ajouté au panier ! Continuez à créer — choisissez votre prochain produit :',
    'crossSell.noThanks': 'Non merci — aller à mon panier →',
    'tips.title': 'Comment ça marche',
    'tips.1': 'Choisissez votre modèle de téléphone et le gel souhaité.',
    'tips.2': 'Parcourez les breloques par Or, Argent, Coloré & Naturel.',
    'tips.3': 'Glissez ou touchez une breloque pour l’ajouter à votre coque.',
    'tips.4': 'Touchez une breloque sur la coque pour la pivoter ou la retirer.',
    'tips.5': 'Si une breloque est surlignée, elle se chevauche ou dépasse la coque — ajustez-la avant de commander. (Minimum 10 breloques)',
    'tips.6': 'Commandez votre coque sur mesure, nous lui donnerons vie.',
    'group.moveOnOwn': 'Déplacer les lettres séparément ?',
    'group.yes': 'Oui',
    'group.no': 'Non',
    'group.confirm': 'Confirmer',
    'group.confirmTip': 'Verrouillez cette position, puis modifiez chaque lettre séparément',
    'action.remove': 'Retirer',
  },

  de: {
    'charm.unavailable': 'Nicht verfügbar',
    'charm.tip.unavailable': 'Derzeit nicht verfügbar',
    'charm.tip.scatter': 'Tippen, um Lücken zu füllen',
    'charm.tip.tapAdd': 'Tippen zum Hinzufügen — dann auf die Hülle ziehen',
    'charm.tip.dragAdd': 'Auf dein Stück ziehen — oder klicken zum Hinzufügen',
    'charm.typeWord': 'Wort oder Zahl eingeben',
    'charm.add': 'Hinzufügen',
    'charm.position': 'Position',
    'charm.position.top': 'Oben',
    'charm.position.middle': 'Mitte',
    'charm.position.bottom': 'Unten',
    'charm.arch': 'Bogen',
    'charm.empty': 'Noch keine Anhänger in dieser Kategorie.',
    'charm.wordPlaceholder': 'z. B. EMMA 24',
    'charm.wordHint': 'Buchstaben & Zahlen mischen, bis zu 14 Zeichen.',
    'charm.yourWords': 'Deine Wörter:',
    'charm.selectWord': 'Wähle dieses Wort, um es als Ganzes zu bewegen',

    'noun.case': 'Hülle',
    'noun.tote': 'Tasche',
    'noun.frame': 'Rahmen',

    'price.ready': 'Bereit zur Bestellung',
    'price.addAtLeast': 'Mindestens {n} Anhänger hinzufügen',
    'price.useAtMost': 'Höchstens {n} Anhänger verwenden',
    'price.needAttention': '{n} Anhänger braucht Aufmerksamkeit',
    'price.needAttention_plural': '{n} Anhänger brauchen Aufmerksamkeit',
    'price.charmCount': '{n} Anhänger',
    'price.charmCount_plural': '{n} Anhänger',
    'price.aimFor': ' · ziele auf {min}–{max}',
    'price.base': '{name} Basis · {price}',
    'price.plusCharms': '+ Anhänger {price}',
    'price.estimatedTotal': 'Geschätzte Summe',
    'price.total': 'Summe',
    'price.orderSummary': 'Bestellübersicht',
    'cta.addToCart': 'Meine individuelle {noun} in den Warenkorb ({price})',
    'cta.addSecondProduct': 'Zweites Produkt in den Warenkorb ({price})',

    'picker.step1': 'Schritt 1 · Wähle deine Basis',
    'picker.caseColour': 'Hüllenfarbe',
    'picker.gelColour': 'Gel-Farbe',
    'picker.colour': 'Farbe',
    'picker.model': 'Modell',
    'picker.availableNow': 'Jetzt verfügbar',
    'picker.comingSoon': 'Demnächst verfügbar',

    'summary.previewAlt': 'Vorschau deines Designs',
    'summary.indicative': 'Rot umrandete Anhänger sind Richtwerte.',
    'summary.fillerNote': ' Füll-Anhänger werden von Hand angeordnet.',
    'summary.download': 'Herunterladen',

    'msg.maxCharms': 'Du kannst bis zu {n} Anhänger hinzufügen.',
    'msg.bundleIncluded': 'Bis zu {n} „{name}“ sind zu einem Preis enthalten.',
    'msg.charsUnavailable': 'Diese Zeichen sind nicht als Anhänger verfügbar.',
    'msg.skipped': 'Übersprungen (kein Anhänger): {chars}',
    'msg.addAtLeastHave': 'Bitte füge vor der Bestellung mindestens {min} Anhänger hinzu — du hast {have}.',
    'msg.useAtMost': 'Bitte verwende höchstens {n} Anhänger.',

    'action.undo': 'Rückgängig',
    'action.clear': 'Löschen',
    'action.back': 'Zurück',
    'action.done': 'Fertig',
    'action.close': 'Schließen',
    'action.cancel': 'Abbrechen',
    'action.zoomIn': 'Vergrößern',
    'action.zoomOut': 'Verkleinern',
    'action.clearAll': 'Alle löschen',
    'action.dismiss': 'Schließen',

    'step1.mobile': 'Schritt 1: Modell wählen',
    'label.case': 'Hülle',
    'label.gel': 'Gel',
    'step2.mobileTitle': 'Schritt 2: Anhänger hinzufügen',
    'step2.mobileHint': 'Tippen, um Anhänger hinzuzufügen. Danach kannst du sie auf der Hülle verschieben und drehen.',
    'step2.desktopTitle': 'Schritt 2 · Füge deine Anhänger hinzu',
    'step2.recommend': 'Wir empfehlen {min}–{max} Anhänger für ein ausgewogenes Bild.',
    'step2.added': ' {n} hinzugefügt.',
    'step2.desktopHint': 'Wir empfehlen {min}–{max} Anhänger für ein ausgewogenes Bild. Mindestens {min2} Anhänger erforderlich.',
    'charms.label': 'Anhänger',
    'charms.selected': '{n} ausgewählt',
    'charms.shrink': 'Auswahl verkleinern',
    'charms.enlarge': 'Auswahl vergrößern',
    'alert.overlap': 'Einige Anhänger überlappen oder liegen außerhalb des Fertigungsbereichs. Schiebe die markierten Anhänger auseinander, bis die Umrisse verschwinden.',
    'aria.splitter': 'Ziehen, um Vorschau und Anhängerfach zu ändern',
    'aria.trayResizer': 'Ziehen, um das Anhängerfach zu ändern',
    'hint.widen': 'Das Fenster ist zu schmal für die Anhänger — verbreitere es oder verkleinere die Ansicht, um alle zu sehen.',
    'crossSell.title': 'Ein zweites Produkt gestalten?',
    'crossSell.body': 'Zum Warenkorb hinzugefügt! Weiter gestalten — wähle dein nächstes Produkt:',
    'crossSell.noThanks': 'Nein danke — zum Warenkorb →',
    'tips.title': 'So funktioniert es',
    'tips.1': 'Wähle dein Handymodell und das gewünschte Gel.',
    'tips.2': 'Durchstöbere Anhänger nach Gold, Silber, Bunt & Natur.',
    'tips.3': 'Ziehe oder tippe einen Anhänger, um ihn zur Hülle hinzuzufügen.',
    'tips.4': 'Tippe einen Anhänger auf der Hülle an, um ihn zu drehen oder zu entfernen.',
    'tips.5': 'Ist ein Anhänger markiert, überlappt er oder liegt außerhalb der Hülle — passe ihn vor dem Bestellen an. (Mindestens 10 Anhänger)',
    'tips.6': 'Bestelle deine maßgefertigte Handyhülle — wir erwecken sie zum Leben.',
    'group.moveOnOwn': 'Buchstaben einzeln bewegen?',
    'group.yes': 'Ja',
    'group.no': 'Nein',
    'group.confirm': 'Bestätigen',
    'group.confirmTip': 'Diese Position sperren, dann jeden Buchstaben einzeln bearbeiten',
    'action.remove': 'Entfernen',
  },

  es: {
    'charm.unavailable': 'No disponible',
    'charm.tip.unavailable': 'No disponible actualmente',
    'charm.tip.scatter': 'Toca para rellenar los huecos',
    'charm.tip.tapAdd': 'Toca para añadir — luego arrástralo a tu funda',
    'charm.tip.dragAdd': 'Arrastra a tu pieza — o haz clic para añadir',
    'charm.typeWord': 'Escribe una palabra o número',
    'charm.add': 'Añadir',
    'charm.position': 'Posición',
    'charm.position.top': 'Arriba',
    'charm.position.middle': 'Centro',
    'charm.position.bottom': 'Abajo',
    'charm.arch': 'Arco',
    'charm.empty': 'Aún no hay dijes en esta categoría.',
    'charm.wordPlaceholder': 'p. ej. EMMA 24',
    'charm.wordHint': 'Combina letras y números, hasta 14 caracteres.',
    'charm.yourWords': 'Tus palabras:',
    'charm.selectWord': 'Selecciona esta palabra para moverla como una',

    'noun.case': 'funda',
    'noun.tote': 'bolsa',
    'noun.frame': 'marco',

    'price.ready': 'Listo para pedir',
    'price.addAtLeast': 'Añade al menos {n} dijes',
    'price.useAtMost': 'Usa como máximo {n} dijes',
    'price.needAttention': '{n} dije necesita ajuste',
    'price.needAttention_plural': '{n} dijes necesitan ajuste',
    'price.charmCount': '{n} dije',
    'price.charmCount_plural': '{n} dijes',
    'price.aimFor': ' · apunta a {min}–{max}',
    'price.base': '{name} base · {price}',
    'price.plusCharms': '+ dijes {price}',
    'price.estimatedTotal': 'Total estimado',
    'price.total': 'Total',
    'price.orderSummary': 'Resumen del pedido',
    'cta.addToCart': 'Añadir mi {noun} personalizada al carrito ({price})',
    'cta.addSecondProduct': 'Añadir segundo producto al carrito ({price})',

    'picker.step1': 'Paso 1 · Elige tu base',
    'picker.caseColour': 'Color de la funda',
    'picker.gelColour': 'Color del gel',
    'picker.colour': 'Color',
    'picker.model': 'Modelo',
    'picker.availableNow': 'Disponible ahora',
    'picker.comingSoon': 'Próximamente',

    'summary.previewAlt': 'Vista previa de tu diseño',
    'summary.indicative': 'Los dijes con contorno rojo son indicativos.',
    'summary.fillerNote': ' Los dijes de relleno se colocan a mano.',
    'summary.download': 'Descargar',

    'msg.maxCharms': 'Puedes añadir hasta {n} dijes.',
    'msg.bundleIncluded': 'Hasta {n} «{name}» se incluyen por un solo precio.',
    'msg.charsUnavailable': 'Esos caracteres no están disponibles como dijes.',
    'msg.skipped': 'Omitido (sin dije): {chars}',
    'msg.addAtLeastHave': 'Añade al menos {min} dijes antes de pedir — tienes {have}.',
    'msg.useAtMost': 'Usa como máximo {n} dijes.',

    'action.undo': 'Deshacer',
    'action.clear': 'Borrar',
    'action.back': 'Atrás',
    'action.done': 'Listo',
    'action.close': 'Cerrar',
    'action.cancel': 'Cancelar',
    'action.zoomIn': 'Acercar',
    'action.zoomOut': 'Alejar',
    'action.clearAll': 'Borrar todo',
    'action.dismiss': 'Cerrar',

    'step1.mobile': 'Paso 1: Elegir modelo',
    'label.case': 'Funda',
    'label.gel': 'Gel',
    'step2.mobileTitle': 'Paso 2: Añadir dijes',
    'step2.mobileHint': 'Toca para añadir dijes. Después, muévelos por la funda y gíralos.',
    'step2.desktopTitle': 'Paso 2 · Añade tus dijes',
    'step2.recommend': 'Recomendamos {min}–{max} dijes para un aspecto equilibrado.',
    'step2.added': ' {n} añadidos.',
    'step2.desktopHint': 'Recomendamos {min}–{max} dijes para un aspecto equilibrado. Mínimo {min2} dijes.',
    'charms.label': 'Dijes',
    'charms.selected': '{n} seleccionados',
    'charms.shrink': 'Reducir el selector',
    'charms.enlarge': 'Ampliar el selector',
    'alert.overlap': 'Algunos dijes se solapan o están fuera del área realizable. Separa los dijes resaltados hasta que desaparezca el contorno.',
    'aria.splitter': 'Arrastra para ajustar la vista previa y la bandeja',
    'aria.trayResizer': 'Arrastra para ajustar la bandeja de dijes',
    'hint.widen': 'La ventana es demasiado estrecha para mostrar los dijes — amplíala o reduce el zoom para verlos todos.',
    'crossSell.title': '¿Personalizar un segundo producto?',
    'crossSell.body': '¡Añadido al carrito! Sigue diseñando — elige tu próximo producto:',
    'crossSell.noThanks': 'No, gracias — ir a mi carrito →',
    'tips.title': 'Cómo funciona',
    'tips.1': 'Elige tu modelo de teléfono y el gel que prefieras.',
    'tips.2': 'Explora los dijes por Oro, Plata, Colorido y Natural.',
    'tips.3': 'Arrastra o toca un dije para añadirlo a tu funda.',
    'tips.4': 'Toca un dije en la funda para girarlo o quitarlo.',
    'tips.5': 'Si un dije está resaltado, se solapa o sale de la funda — ajústalo antes de pedir. (Mínimo 10 dijes)',
    'tips.6': 'Pide tu funda personalizada y le daremos vida.',
    'group.moveOnOwn': '¿Mover las letras por separado?',
    'group.yes': 'Sí',
    'group.no': 'No',
    'group.confirm': 'Confirmar',
    'group.confirmTip': 'Fija esta posición y luego edita cada letra por separado',
    'action.remove': 'Quitar',
  },

  ja: {
    'charm.unavailable': '在庫なし',
    'charm.tip.unavailable': '現在ご利用いただけません',
    'charm.tip.scatter': 'タップして隙間に散りばめる',
    'charm.tip.tapAdd': 'タップして追加 — ケースにドラッグ',
    'charm.tip.dragAdd': '作品にドラッグ — またはクリックで追加',
    'charm.typeWord': '文字または数字を入力',
    'charm.add': '追加',
    'charm.position': '位置',
    'charm.position.top': '上',
    'charm.position.middle': '中央',
    'charm.position.bottom': '下',
    'charm.arch': 'アーチ',
    'charm.empty': 'このカテゴリーにはまだチャームがありません。',
    'charm.wordPlaceholder': '例：EMMA 24',
    'charm.wordHint': '文字と数字を組み合わせて最大 14 文字。',
    'charm.yourWords': 'あなたの言葉：',
    'charm.selectWord': 'この言葉を選択してまとめて移動',

    'noun.case': 'ケース',
    'noun.tote': 'トート',
    'noun.frame': 'フレーム',

    'price.ready': '注文の準備ができました',
    'price.addAtLeast': 'チャームを{n}個以上追加してください',
    'price.useAtMost': 'チャームは{n}個までです',
    'price.needAttention': '{n}個のチャームを調整してください',
    'price.needAttention_plural': '{n}個のチャームを調整してください',
    'price.charmCount': 'チャーム{n}個',
    'price.charmCount_plural': 'チャーム{n}個',
    'price.aimFor': ' · {min}〜{max}個が目安',
    'price.base': '{name} 基本 · {price}',
    'price.plusCharms': '+ チャーム {price}',
    'price.estimatedTotal': '合計（概算）',
    'price.total': '合計',
    'price.orderSummary': '注文概要',
    'cta.addToCart': 'カスタム{noun}をカートに追加（{price}）',
    'cta.addSecondProduct': '2つ目の商品をカートに追加（{price}）',

    'picker.step1': 'ステップ1 · ベースを選択',
    'picker.caseColour': 'ケースの色',
    'picker.gelColour': 'ジェルの色',
    'picker.colour': '色',
    'picker.model': 'モデル',
    'picker.availableNow': '販売中',
    'picker.comingSoon': '近日発売',

    'summary.previewAlt': 'デザインのプレビュー',
    'summary.indicative': '赤い枠のチャームは参考です。',
    'summary.fillerNote': ' フィラーチャームは手作業で配置します。',
    'summary.download': 'ダウンロード',

    'msg.maxCharms': 'チャームは最大{n}個まで追加できます。',
    'msg.bundleIncluded': '「{name}」は最大{n}個まで1つの価格に含まれます。',
    'msg.charsUnavailable': 'これらの文字に対応するチャームはありません。',
    'msg.skipped': 'スキップ（該当チャームなし）：{chars}',
    'msg.addAtLeastHave': 'ご注文前にチャームを{min}個以上追加してください — 現在{have}個です。',
    'msg.useAtMost': 'チャームは{n}個までにしてください。',

    'action.undo': '元に戻す',
    'action.clear': 'クリア',
    'action.back': '戻る',
    'action.done': '完了',
    'action.close': '閉じる',
    'action.cancel': 'キャンセル',
    'action.zoomIn': '拡大',
    'action.zoomOut': '縮小',
    'action.clearAll': 'すべてクリア',
    'action.dismiss': '閉じる',

    'step1.mobile': 'ステップ1：モデルを選択',
    'label.case': 'ケース',
    'label.gel': 'ジェル',
    'step2.mobileTitle': 'ステップ2：チャームを追加',
    'step2.mobileHint': 'タップしてチャームを追加。追加後はケース上で移動・回転できます。',
    'step2.desktopTitle': 'ステップ2 · チャームを追加',
    'step2.recommend': 'バランスの良い仕上がりには{min}〜{max}個のチャームがおすすめです。',
    'step2.added': ' {n}個追加。',
    'step2.desktopHint': 'バランスの良い仕上がりには{min}〜{max}個がおすすめです。最低{min2}個必要です。',
    'charms.label': 'チャーム',
    'charms.selected': '{n}個選択中',
    'charms.shrink': 'チャーム選択を縮小',
    'charms.enlarge': 'チャーム選択を拡大',
    'alert.overlap': '一部のチャームが重なっているか、制作可能エリアの外にあります。輪郭が消えるまで、ハイライトされたチャームを離してください。',
    'aria.splitter': 'ドラッグしてプレビューとトレイのサイズを調整',
    'aria.trayResizer': 'ドラッグしてチャームトレイのサイズを調整',
    'hint.widen': 'ウィンドウが狭くてチャームを表示できません — 幅を広げるか、ズームアウトしてすべて表示してください。',
    'crossSell.title': '2つ目の商品もカスタマイズしますか？',
    'crossSell.body': 'カートに追加しました！デザインを続けて、次の商品を選びましょう：',
    'crossSell.noThanks': 'いいえ — カートへ →',
    'tips.title': '使い方',
    'tips.1': 'お使いのスマホ機種とお好みのジェルを選択。',
    'tips.2': 'ゴールド・シルバー・カラフル・ナチュラルでチャームを探す。',
    'tips.3': 'チャームをドラッグまたはタップしてケースに追加。',
    'tips.4': 'ケース上のチャームをタップして回転・削除。',
    'tips.5': 'チャームがハイライトされている場合は、重なりやケースからのはみ出しです — ご注文前に調整してください。（チャームは最低10個必要）',
    'tips.6': 'オーダーメイドのスマホケースをご注文ください。私たちが形にします。',
    'group.moveOnOwn': '文字を個別に移動しますか？',
    'group.yes': 'はい',
    'group.no': 'いいえ',
    'group.confirm': '確定',
    'group.confirmTip': 'この位置を固定して、各文字を個別に編集',
    'action.remove': '削除',
  },
}

function interpolate(str, params) {
  if (!params) return str
  return str.replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? params[k] : m))
}

/** Translate `key` (with optional `{param}` interpolation). Falls back to English, then the key. */
export function t(key, params) {
  const lang = currentLang()
  const table = DICT[lang] || DICT.en
  const str = table[key] != null ? table[key] : DICT.en[key] != null ? DICT.en[key] : key
  return interpolate(str, params)
}

/**
 * Count-aware translation: uses `key` for n === 1 and `key`+'_plural' otherwise
 * (languages without a plural distinction simply define both the same). `{n}` is
 * auto-supplied.
 */
export function tn(key, n, params) {
  const pluralKey = n === 1 ? key : `${key}_plural`
  const lang = currentLang()
  const table = DICT[lang] || DICT.en
  const chosen =
    table[pluralKey] != null
      ? table[pluralKey]
      : DICT.en[pluralKey] != null
        ? DICT.en[pluralKey]
        : table[key] != null
          ? table[key]
          : DICT.en[key] != null
            ? DICT.en[key]
            : key
  return interpolate(chosen, { n, ...params })
}
