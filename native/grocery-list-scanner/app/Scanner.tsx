/**
 * Scanner.tsx — Native barcode scanner screen
 *
 * Navigated to when the WebView intercepts /scanner (with optional query params).
 * URL params forwarded via navigation.navigate("scanner", { wishList, count, text })
 *
 * Modes:
 *   Auto   → live camera barcode scan (EAN-8/13)
 *   Manual → "By Name" text input  |  "By Barcode" numeric input
 *
 * After a successful scan/submit, if the API responds with
 * mode === "needs_quantity" (or needs_quantity === true), a bottom-sheet
 * modal prompts for product_quantity + product_quantity_unit, then re-submits
 * with quantity_data populated.
 *
 * Theme: reads localStorage "theme" ("dark"|"light") via the WebView bridge,
 * then falls back to Appearance.getColorScheme().
 *
 * i18n: reads localStorage "i18n_lang" (en|de|pt|fr|es|tr) via bridge.
 */

import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Appearance,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useAuthSession } from "../lib/AuthSession";
import { MOBILE_LOGIN_ROUTE } from "../lib/config";
import { addEanToList } from "../lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

type ScannerMode = "auto" | "manual";
type ManualTab = "name" | "barcode";
type InventoryAction = "add" | "remove";
type ColorScheme = "dark" | "light";

interface QuantityInfo {
  product_quantity: number | null;
  product_quantity_unit: string | null;
}

interface ApiResponse {
  ean?: string | null;
  product_name?: string | null;
  done?: boolean;
  known_to_db?: boolean | string;
  mode?: string;
  operation?: string;
  needs_quantity?: boolean;
}

// ─── i18n ─────────────────────────────────────────────────────────────────────

type LangKey =
  | "back"
  | "title"
  | "auto"
  | "manual"
  | "byName"
  | "byBarcode"
  | "itemName"
  | "namePlaceholder"
  | "barcodeLabel"
  | "barcodePlaceholder"
  | "units"
  | "addBtn"
  | "removeBtn"
  | "pointCamera"
  | "noCameraTitle"
  | "noCameraBody"
  | "allowCamera"
  | "added"
  | "removed"
  | "networkError"
  | "sessionMissing"
  | "abort"
  | "working"
  | "wishlist"
  | "inventory"
  | "digits"
  | "quantityModalTitle"
  | "quantityModalSubtitle"
  | "quantityModalSave"
  | "quantityModalCancel"
  | "quantityLabel"
  | "unitLabel"
  | "quantityRequired";

const I18N: Record<string, Record<LangKey, string>> = {
  en: {
    back: "← Back",
    title: "Add / Remove",
    auto: "Auto",
    manual: "Manual",
    byName: "By Name",
    byBarcode: "By Barcode",
    itemName: "Item name",
    namePlaceholder: "e.g. Milk, Bread, Apples…",
    barcodeLabel: "Barcode / EAN",
    barcodePlaceholder: "e.g. 4006040055136",
    units: "Units",
    addBtn: "Add",
    removeBtn: "Remove",
    pointCamera: "Point camera at barcode",
    noCameraTitle: "Camera Access",
    noCameraBody: "Allow camera access to scan barcodes",
    allowCamera: "Allow Camera",
    added: "Added",
    removed: "Removed",
    networkError: "Network error",
    sessionMissing: "Session missing — please sign in",
    abort: "Cancel scan",
    working: "Working…",
    wishlist: "Wish list",
    inventory: "Inventory",
    digits: "digits",
    quantityModalTitle: "Add Quantity & Unit",
    quantityModalSubtitle: "The server needs quantity info for",
    quantityModalSave: "Save item with quantity",
    quantityModalCancel: "Cancel",
    quantityLabel: "QUANTITY",
    unitLabel: "UNIT",
    quantityRequired: "QUANTITY REQUIRED",
  },
  de: {
    back: "← Zurück",
    title: "Hinzufügen / Löschen",
    auto: "Auto",
    manual: "Manuell",
    byName: "Nach Name",
    byBarcode: "Nach Barcode",
    itemName: "Artikelname",
    namePlaceholder: "z.B. Milch, Brot, Äpfel…",
    barcodeLabel: "Barcode / EAN",
    barcodePlaceholder: "z.B. 4006040055136",
    units: "Einheiten",
    addBtn: "Hinzufügen",
    removeBtn: "Löschen",
    pointCamera: "Kamera auf Barcode richten",
    noCameraTitle: "Kamerazugriff",
    noCameraBody: "Kamerazugriff erlauben, um Barcodes zu scannen",
    allowCamera: "Kamera erlauben",
    added: "Hinzugefügt",
    removed: "Entfernt",
    networkError: "Netzwerkfehler",
    sessionMissing: "Sitzung fehlt – bitte anmelden",
    abort: "Scan abbrechen",
    working: "Wird verarbeitet…",
    wishlist: "Einkaufsliste",
    inventory: "Inventar",
    digits: "Ziffern",
    quantityModalTitle: "Menge und Einheit hinzufügen",
    quantityModalSubtitle: "Der Server benötigt Mengenangaben für",
    quantityModalSave: "Artikel mit Menge speichern",
    quantityModalCancel: "Abbrechen",
    quantityLabel: "EINHEITEN",
    unitLabel: "EINHEIT",
    quantityRequired: "MENGE ERFORDERLICH",
  },
  pt: {
    back: "← Voltar",
    title: "Adicionar / Remover",
    auto: "Auto",
    manual: "Manual",
    byName: "Por Nome",
    byBarcode: "Por Código",
    itemName: "Nome do item",
    namePlaceholder: "ex: Leite, Pão, Maçãs…",
    barcodeLabel: "Código de barras / EAN",
    barcodePlaceholder: "ex: 4006040055136",
    units: "Unidades",
    addBtn: "Adicionar",
    removeBtn: "Remover",
    pointCamera: "Aponte a câmera para o código",
    noCameraTitle: "Acesso à câmera",
    noCameraBody: "Permita o acesso à câmera para escanear códigos",
    allowCamera: "Permitir câmera",
    added: "Adicionado",
    removed: "Removido",
    networkError: "Erro de rede",
    sessionMissing: "Sessão expirada — faça login",
    abort: "Cancelar scan",
    working: "Processando…",
    wishlist: "Lista de compras",
    inventory: "Inventário",
    digits: "dígitos",
    quantityModalTitle: "Adicionar Quantidade e Unidade",
    quantityModalSubtitle:
      "O servidor precisa de informações de quantidade para",
    quantityModalSave: "Salvar item com quantidade",
    quantityModalCancel: "Cancelar",
    quantityLabel: "QUANTIDADE",
    unitLabel: "UNIDADE",
    quantityRequired: "QUANTIDADE NECESSÁRIA",
  },
  fr: {
    back: "← Retour",
    title: "Ajouter / Supprimer",
    auto: "Auto",
    manual: "Manuel",
    byName: "Par Nom",
    byBarcode: "Par Code",
    itemName: "Nom de l'article",
    namePlaceholder: "ex : Lait, Pain, Pommes…",
    barcodeLabel: "Code-barres / EAN",
    barcodePlaceholder: "ex : 4006040055136",
    units: "Unités",
    addBtn: "Ajouter",
    removeBtn: "Supprimer",
    pointCamera: "Pointez la caméra vers le code",
    noCameraTitle: "Accès caméra",
    noCameraBody: "Autoriser l'accès caméra pour scanner les codes",
    allowCamera: "Autoriser la caméra",
    added: "Ajouté",
    removed: "Supprimé",
    networkError: "Erreur réseau",
    sessionMissing: "Session manquante — veuillez vous connecter",
    abort: "Annuler le scan",
    working: "En cours…",
    wishlist: "Liste de courses",
    inventory: "Inventaire",
    digits: "chiffres",
    quantityModalTitle: "Ajouter Quantité et Unité",
    quantityModalSubtitle:
      "Le serveur a besoin d'informations de quantité pour",
    quantityModalSave: "Enregistrer l'article avec la quantité",
    quantityModalCancel: "Annuler",
    quantityLabel: "QUANTITÉ",
    unitLabel: "UNITÉ",
    quantityRequired: "QUANTITÉ REQUISE",
  },
  es: {
    back: "← Atrás",
    title: "Añadir / Eliminar",
    auto: "Auto",
    manual: "Manual",
    byName: "Por Nombre",
    byBarcode: "Por Código",
    itemName: "Nombre del artículo",
    namePlaceholder: "ej: Leche, Pan, Manzanas…",
    barcodeLabel: "Código de barras / EAN",
    barcodePlaceholder: "ej: 4006040055136",
    units: "Unidades",
    addBtn: "Añadir",
    removeBtn: "Eliminar",
    pointCamera: "Apunte la cámara al código",
    noCameraTitle: "Acceso a la cámara",
    noCameraBody: "Permita el acceso a la cámara para escanear códigos",
    allowCamera: "Permitir cámara",
    added: "Añadido",
    removed: "Eliminado",
    networkError: "Error de red",
    sessionMissing: "Sesión no encontrada — inicie sesión",
    abort: "Cancelar escaneo",
    working: "Procesando…",
    wishlist: "Lista de la compra",
    inventory: "Inventario",
    digits: "dígitos",
    quantityModalTitle: "Añadir Cantidad y Unidad",
    quantityModalSubtitle: "El servidor necesita información de cantidad para",
    quantityModalSave: "Guardar artículo con cantidad",
    quantityModalCancel: "Cancelar",
    quantityLabel: "CANTIDAD",
    unitLabel: "UNIDAD",
    quantityRequired: "CANTIDAD REQUERIDA",
  },
  tr: {
    back: "← Geri",
    title: "Ekle / Çıkar",
    auto: "Otomatik",
    manual: "Manuel",
    byName: "İsme Göre",
    byBarcode: "Barkoda Göre",
    itemName: "Ürün adı",
    namePlaceholder: "örn: Süt, Ekmek, Elma…",
    barcodeLabel: "Barkod / EAN",
    barcodePlaceholder: "örn: 4006040055136",
    units: "Birim",
    addBtn: "Ekle",
    removeBtn: "Çıkar",
    pointCamera: "Kamerayı barkoda tutun",
    noCameraTitle: "Kamera Erişimi",
    noCameraBody: "Barkod taramak için kamera erişimine izin verin",
    allowCamera: "Kameraya İzin Ver",
    added: "Eklendi",
    removed: "Çıkarıldı",
    networkError: "Ağ hatası",
    sessionMissing: "Oturum bulunamadı — lütfen giriş yapın",
    abort: "Taramayı iptal et",
    working: "İşleniyor…",
    wishlist: "Alışveriş listesi",
    inventory: "Envanter",
    digits: "basamak",
    quantityModalTitle: "Miktar ve Birim Ekle",
    quantityModalSubtitle: "Sunucu şu ürün için miktar bilgisi gerektiriyor:",
    quantityModalSave: "Ürünü miktarla kaydet",
    quantityModalCancel: "İptal",
    quantityLabel: "MİKTAR",
    unitLabel: "BİRİM",
    quantityRequired: "MİKTAR GEREKLİ",
  },
};

const UNIT_OPTIONS = [
  "Stück",
  "g",
  "kg",
  "ml",
  "l",
  "Packung",
  "Dose",
  "Flasche",
  "Beutel",
];

// ─── Theme tokens ─────────────────────────────────────────────────────────────

const DARK = {
  bg: "#12141a",
  surface: "#1e222d",
  surfaceAlt: "#272c39",
  border: "rgba(255,255,255,0.08)",
  borderFocus: "#7c80f4",
  text: "#f8f9fa",
  textSub: "rgba(255,255,255,0.55)",
  textMuted: "rgba(255,255,255,0.35)",
  accent: "#5c5cf2", // Brought in closer to the auth modal blue/purple
  accentBg: "rgba(92,92,242,0.15)",
  success: "#16a34a",
  successBg: "rgba(22,163,74,0.15)",
  successText: "#4ade80",
  danger: "#dc2626",
  dangerBg: "rgba(255,255,255,0.06)", // Revert harsh red backgrounds to look sleeker
  dangerText: "#e2e8f0",
  dangerBorder: "rgba(255,255,255,0.1)",
  pill: "rgba(255,255,255,0.05)",
  pillActive: "#5c5cf2",
  segBg: "rgba(255,255,255,0.03)",
  toastSuccessBg: "rgba(22,163,74,0.9)",
  toastSuccessText: "#ecfdf5",
  toastErrorBg: "rgba(220,38,38,0.9)",
  toastErrorText: "#fef2f2",
  modalBg: "#1e222d",
  scanOverlay: "rgba(18,20,26,0.65)",
  corner: "#5c5cf2",
  glass: "rgba(30,34,45,0.85)",
};

const LIGHT = {
  bg: "#f8f9fa",
  surface: "#ffffff",
  surfaceAlt: "#f1f3f5",
  border: "rgba(0,0,0,0.08)",
  borderFocus: "#5c5cf2",
  text: "#111827",
  textSub: "rgba(0,0,0,0.6)",
  textMuted: "rgba(0,0,0,0.45)",
  accent: "#5c5cf2",
  accentBg: "rgba(92,92,242,0.15)",
  success: "#15803d",
  successBg: "#f0fdf4",
  successText: "#15803d",
  danger: "#dc2626",
  dangerBg: "rgba(0,0,0,0.04)",
  dangerText: "#111827",
  dangerBorder: "rgba(0,0,0,0.08)",
  pill: "rgba(0,0,0,0.08)",
  pillActive: "#5c5cf2",
  segBg: "rgba(0,0,0,0.06)",
  toastSuccessBg: "rgba(21,128,61,0.9)",
  toastSuccessText: "#ffffff",
  toastErrorBg: "rgba(220,38,38,0.9)",
  toastErrorText: "#ffffff",
  modalBg: "#ffffff",
  scanOverlay: "rgba(0,0,0,0.35)",
  corner: "#5c5cf2",
  glass: "rgba(255,255,255,0.9)",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getThemeFromStorage(): ColorScheme | null {
  try {
    if (typeof localStorage !== "undefined") {
      const v = localStorage.getItem("theme");
      if (v === "dark" || v === "light") return v;
    }
  } catch {}
  return null;
}

function getLangFromStorage(): string {
  try {
    if (typeof localStorage !== "undefined") {
      const v = localStorage.getItem("i18n_lang");
      if (v && I18N[v]) return v;
    }
  } catch {}
  return "en";
}

function needsQuantity(data: ApiResponse): boolean {
  return (
    data.needs_quantity === true ||
    data.mode === "needs_quantity" ||
    data.mode === "quantity_required"
  );
}

// ─── Quantity Modal ───────────────────────────────────────────────────────────

interface QuantityModalProps {
  visible: boolean;
  productName: string | null;
  t: (k: LangKey) => string;
  C: typeof DARK;
  onSave: (qty: QuantityInfo) => void;
  onCancel: () => void;
}

function QuantityModal({
  visible,
  productName,
  t,
  C,
  onSave,
  onCancel,
}: QuantityModalProps) {
  const [qty, setQty] = useState("1");
  const [unit, setUnit] = useState(UNIT_OPTIONS[0]);
  const [showUnitPicker, setShowUnitPicker] = useState(false);

  const handleSave = useCallback(() => {
    const parsed = parseInt(qty, 10);
    onSave({
      product_quantity: isNaN(parsed) || parsed < 1 ? 1 : parsed,
      product_quantity_unit: unit,
    });
  }, [qty, unit, onSave]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onCancel}
    >
      <TouchableWithoutFeedback onPress={onCancel}>
        <View style={qStyles.backdrop} />
      </TouchableWithoutFeedback>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={qStyles.kav}
        pointerEvents="box-none"
      >
        <View
          style={[
            qStyles.sheet,
            { backgroundColor: C.modalBg, borderColor: C.border },
          ]}
        >
          {/* Handle */}
          <View style={[qStyles.handle, { backgroundColor: C.border }]} />

          {/* Badge */}
          <View
            style={[
              qStyles.badge,
              { borderColor: C.accent, backgroundColor: C.accentBg },
            ]}
          >
            <Text style={[qStyles.badgeText, { color: C.accent }]}>
              {t("quantityRequired")}
            </Text>
          </View>

          <Text style={[qStyles.title, { color: C.text }]}>
            {t("quantityModalTitle")}
          </Text>
          <Text style={[qStyles.subtitle, { color: C.textSub }]}>
            {t("quantityModalSubtitle")}{" "}
            <Text style={{ fontWeight: "700", color: C.text }}>
              {productName || "?"}
            </Text>
          </Text>

          <View style={qStyles.row}>
            {/* Quantity input */}
            <View style={qStyles.qtyCol}>
              <Text style={[qStyles.fieldLabel, { color: C.textMuted }]}>
                {t("quantityLabel")}
              </Text>
              <View
                style={[
                  qStyles.inputWrap,
                  { backgroundColor: C.surfaceAlt, borderColor: C.border },
                ]}
              >
                <TextInput
                  style={[qStyles.qtyInput, { color: C.text }]}
                  value={qty}
                  onChangeText={setQty}
                  keyboardType="number-pad"
                  maxLength={6}
                  selectTextOnFocus
                  placeholderTextColor={C.textMuted}
                />
                <View style={qStyles.spinners}>
                  <Pressable
                    style={({ pressed }) => [
                      qStyles.spinBtn,
                      pressed && { opacity: 0.6 },
                    ]}
                    onPress={() => {
                      const n = parseInt(qty, 10);
                      setQty(String(isNaN(n) ? 2 : n + 1));
                    }}
                  >
                    <Text style={[qStyles.spinText, { color: C.textSub }]}>
                      ▲
                    </Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [
                      qStyles.spinBtn,
                      pressed && { opacity: 0.6 },
                    ]}
                    onPress={() => {
                      const n = parseInt(qty, 10);
                      setQty(String(isNaN(n) || n <= 1 ? 1 : n - 1));
                    }}
                  >
                    <Text style={[qStyles.spinText, { color: C.textSub }]}>
                      ▼
                    </Text>
                  </Pressable>
                </View>
              </View>
            </View>

            {/* Unit picker */}
            <View style={qStyles.unitCol}>
              <Text style={[qStyles.fieldLabel, { color: C.textMuted }]}>
                {t("unitLabel")}
              </Text>
              <Pressable
                style={[
                  qStyles.unitBtn,
                  {
                    backgroundColor: C.surfaceAlt,
                    borderColor: showUnitPicker ? C.accent : C.border,
                  },
                ]}
                onPress={() => setShowUnitPicker((p) => !p)}
              >
                <Text style={[qStyles.unitBtnText, { color: C.text }]}>
                  {unit}
                </Text>
                <Text style={[qStyles.unitChevron, { color: C.textSub }]}>
                  {showUnitPicker ? "▲" : "▼"}
                </Text>
              </Pressable>
            </View>
          </View>

          {/* Unit dropdown */}
          {showUnitPicker && (
            <View
              style={[
                qStyles.dropdown,
                { backgroundColor: C.surfaceAlt, borderColor: C.border },
              ]}
            >
              <ScrollView
                style={{ maxHeight: 180 }}
                showsVerticalScrollIndicator={false}
              >
                {UNIT_OPTIONS.map((u) => (
                  <Pressable
                    key={u}
                    style={({ pressed }) => [
                      qStyles.dropItem,
                      { borderBottomColor: C.border },
                      u === unit && { backgroundColor: C.accentBg },
                      pressed && { opacity: 0.7 },
                    ]}
                    onPress={() => {
                      setUnit(u);
                      setShowUnitPicker(false);
                    }}
                  >
                    <Text
                      style={[
                        qStyles.dropItemText,
                        { color: u === unit ? C.accent : C.text },
                      ]}
                    >
                      {u}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}

          {/* Buttons */}
          <Pressable
            style={({ pressed }) => [
              qStyles.saveBtn,
              { backgroundColor: "#4a7c59" },
              pressed && { opacity: 0.85 },
            ]}
            onPress={handleSave}
          >
            <Text style={qStyles.saveBtnText}>{t("quantityModalSave")}</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              qStyles.cancelBtn,
              { backgroundColor: C.surfaceAlt, borderColor: C.border },
              pressed && { opacity: 0.75 },
            ]}
            onPress={onCancel}
          >
            <Text style={[qStyles.cancelBtnText, { color: C.textSub }]}>
              {t("quantityModalCancel")}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const qStyles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  kav: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    paddingHorizontal: 22,
    paddingTop: 14,
    paddingBottom: 40,
    gap: 14,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 6,
  },
  badge: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: 20,
    paddingVertical: 5,
    paddingHorizontal: 12,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
  },
  row: {
    flexDirection: "row",
    gap: 12,
    marginTop: 4,
  },
  qtyCol: { flex: 1 },
  unitCol: { flex: 1 },
  fieldLabel: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
  },
  qtyInput: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 14,
    fontSize: 16,
    fontWeight: "500",
  },
  spinners: {
    paddingRight: 6,
    gap: 2,
  },
  spinBtn: {
    padding: 4,
  },
  spinText: {
    fontSize: 10,
  },
  unitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  unitBtnText: {
    fontSize: 16,
    fontWeight: "500",
  },
  unitChevron: {
    fontSize: 11,
    marginLeft: 8,
  },
  dropdown: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
    marginTop: -6,
  },
  dropItem: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dropItemText: {
    fontSize: 15,
    fontWeight: "500",
  },
  saveBtn: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 4,
  },
  saveBtnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
  cancelBtn: {
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 14,
    alignItems: "center",
  },
  cancelBtnText: {
    fontSize: 15,
    fontWeight: "600",
  },
});

// ─── Main Scanner ─────────────────────────────────────────────────────────────

export default function Scanner() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { jwtToken, clearSession } = useAuthSession();

  // Route params from web navigation (?wishlist=true&count=1&text=...)
  const routeWishList =
    route.params?.wishList === "true" || route.params?.wishList === true;
  const routeCount = parseInt(route.params?.count ?? "1", 10) || 1;
  const routeText = route.params?.text ?? "";

  // Theme & i18n — read from localStorage (injected by WebView bridge) or system
  const [colorScheme, setColorScheme] = useState<ColorScheme>(() => {
    const stored = getThemeFromStorage();
    if (stored) return stored;
    return Appearance.getColorScheme() === "light" ? "light" : "dark";
  });
  const lang = getLangFromStorage();
  const C = colorScheme === "light" ? LIGHT : DARK;
  const t = useCallback(
    (k: LangKey) => (I18N[lang] ?? I18N.en)[k] ?? I18N.en[k],
    [lang],
  );

  // Listen for system theme changes as fallback
  useEffect(() => {
    const stored = getThemeFromStorage();
    if (stored) return;
    const sub = Appearance.addChangeListener(({ colorScheme: cs }) => {
      setColorScheme(cs === "light" ? "light" : "dark");
    });
    return () => sub.remove();
  }, []);

  const [permission, requestPermission] = useCameraPermissions();
  const [scannerMode, setScannerMode] = useState<ScannerMode>("auto");
  const [manualTab, setManualTab] = useState<ManualTab>("name");

  // Auto scan state
  const [scanned, setScanned] = useState(false);
  const [ean, setEan] = useState("");
  const [datatype, setDatatype] = useState("");

  // Manual state
  const [manualName, setManualName] = useState(routeText);
  const [manualBarcode, setManualBarcode] = useState("");
  const [count, setCount] = useState(routeCount);

  const [sending, setSending] = useState(false);

  // Quantity modal
  const [qtyModal, setQtyModal] = useState<{
    visible: boolean;
    productName: string | null;
    pendingPayload: Parameters<typeof addEanToList>[1] | null;
    pendingAction: InventoryAction;
  }>({
    visible: false,
    productName: null,
    pendingPayload: null,
    pendingAction: "add",
  });

  // Toast
  const [toast, setToast] = useState<{
    message: string;
    success: boolean;
  } | null>(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback(
    (success: boolean, message: string) => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      setToast({ message, success });
      toastOpacity.setValue(0);
      Animated.timing(toastOpacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }).start();
      toastTimer.current = setTimeout(() => {
        Animated.timing(toastOpacity, {
          toValue: 0,
          duration: 280,
          useNativeDriver: true,
        }).start(() => setToast(null));
      }, 2400);
    },
    [toastOpacity],
  );

  const resetAutoScan = useCallback(() => {
    setScanned(false);
    setEan("");
    setDatatype("");
    setCount(1);
  }, []);

  const goBack = useCallback(() => {
    navigation.navigate("web");
  }, [navigation]);

  // ── Core submit logic ──────────────────────────────────────────────────────

  const doSubmit = useCallback(
    async (
      payload: Parameters<typeof addEanToList>[1],
      action: InventoryAction,
    ) => {
      if (sending || !jwtToken) return;
      setSending(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      try {
        const data = (await addEanToList(jwtToken, payload)) as ApiResponse;

        if (needsQuantity(data)) {
          // Server needs quantity — show modal, preserving payload for retry
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          setQtyModal({
            visible: true,
            productName:
              data.product_name ?? payload.item_name ?? payload.ean ?? null,
            pendingPayload: payload,
            pendingAction: action,
          });
          resetAutoScan();
          return;
        }

        const itemLabel = String(
          data.product_name || payload.item_name || payload.ean || "item",
        );
        const isRemove =
          String(data.operation ?? "").toLowerCase() === "delete" ||
          action === "remove";

        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showToast(
          true,
          `${isRemove ? t("removed") : t("added")} ${count}× ${itemLabel}`,
        );
        resetAutoScan();
        setManualName("");
        setManualBarcode("");
        setCount(1);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        if (msg.startsWith("HTTP 401")) {
          clearSession();
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          showToast(false, t("sessionMissing"));
          navigation.navigate(MOBILE_LOGIN_ROUTE);
          return;
        }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        showToast(false, t("networkError"));
        resetAutoScan();
      } finally {
        setSending(false);
      }
    },
    [
      clearSession,
      count,
      jwtToken,
      navigation,
      resetAutoScan,
      sending,
      showToast,
      t,
    ],
  );

  const submitEan = useCallback(
    async (action: InventoryAction) => {
      if (!ean) return;
      const requestedCount = Math.max(1, count);
      const countDelta = action === "remove" ? -requestedCount : requestedCount;
      await doSubmit(
        {
          ean,
          count: countDelta,
          wish_list: routeWishList ? "true" : "false",
        },
        action,
      );
    },
    [doSubmit, ean, count, routeWishList],
  );

  const submitManualName = useCallback(
    async (action: InventoryAction) => {
      if (!manualName.trim()) return;
      const requestedCount = Math.max(1, count);
      const countDelta = action === "remove" ? -requestedCount : requestedCount;
      await doSubmit(
        {
          item_name: manualName.trim(),
          count: countDelta,
          wish_list: routeWishList ? "true" : "false",
        },
        action,
      );
    },
    [doSubmit, manualName, count, routeWishList],
  );

  const submitManualBarcode = useCallback(
    async (action: InventoryAction) => {
      if (!manualBarcode.trim()) return;
      const requestedCount = Math.max(1, count);
      const countDelta = action === "remove" ? -requestedCount : requestedCount;
      await doSubmit(
        {
          ean: manualBarcode.trim(),
          count: countDelta,
          wish_list: routeWishList ? "true" : "false",
        },
        action,
      );
    },
    [doSubmit, manualBarcode, count, routeWishList],
  );

  // Quantity modal resolution
  const handleQtyModalSave = useCallback(
    async (qty: QuantityInfo) => {
      if (!qtyModal.pendingPayload) return;
      setQtyModal((p) => ({ ...p, visible: false }));
      const newPayload = { ...qtyModal.pendingPayload, quantity_data: qty };
      await doSubmit(newPayload, qtyModal.pendingAction);
    },
    [doSubmit, qtyModal],
  );

  const handleQtyModalCancel = useCallback(() => {
    setQtyModal((p) => ({ ...p, visible: false }));
  }, []);

  // ── Permission screens ─────────────────────────────────────────────────────

  if (!permission) {
    return <View style={[s.fill, { backgroundColor: C.bg }]} />;
  }

  if (!permission.granted) {
    return (
      <View style={[s.fill, s.center, { backgroundColor: C.bg, padding: 32 }]}>
        <Text style={[s.permTitle, { color: C.text }]}>
          {t("noCameraTitle")}
        </Text>
        <Text style={[s.permBody, { color: C.textSub }]}>
          {t("noCameraBody")}
        </Text>
        <Pressable
          style={({ pressed }) => [
            s.permBtn,
            { backgroundColor: C.accent },
            pressed && { opacity: 0.8 },
          ]}
          onPress={requestPermission}
        >
          <Text style={s.permBtnText}>{t("allowCamera")}</Text>
        </Pressable>
      </View>
    );
  }

  // ── Layout ─────────────────────────────────────────────────────────────────

  const isWishList = routeWishList;
  const listLabel = isWishList ? t("wishlist") : t("inventory");

  return (
    <View style={[s.fill, { backgroundColor: C.bg }]}>
      {/* ── HEADER ── */}
      <View
        style={[
          s.header,
          { borderBottomColor: C.border, backgroundColor: C.surface },
        ]}
      >
        <View style={s.headerTop}>
          <Pressable
            style={({ pressed }) => [
              s.backBtn,
              { backgroundColor: C.surfaceAlt },
              pressed && { opacity: 0.7 },
            ]}
            onPress={goBack}
          >
            <Text style={[s.backBtnText, { color: C.textSub }]}>
              {t("back")}
            </Text>
          </Pressable>

          <View style={s.headerCenter}>
            <Text style={[s.headerTitle, { color: C.text }]}>{t("title")}</Text>
            <View
              style={[
                s.listBadge,
                { backgroundColor: isWishList ? C.accentBg : C.pill },
              ]}
            >
              <Text
                style={[
                  s.listBadgeText,
                  { color: isWishList ? C.accent : C.textSub },
                ]}
              >
                {listLabel}
              </Text>
            </View>
          </View>

          {/* Invisible placeholder to balance the back button */}
          <View style={s.backBtnPlaceholder} pointerEvents="none" />
        </View>

        {/* Mode toggle */}
        <View style={s.headerToggleWrap}>
          <View style={[s.modePill, { backgroundColor: C.segBg }]}>
            {(["auto", "manual"] as ScannerMode[]).map((m) => (
              <Pressable
                key={m}
                style={({ pressed }) => [
                  s.modePillItem,
                  scannerMode === m && {
                    backgroundColor: C.surface,
                    shadowColor: "#000",
                    shadowOpacity: 0.05,
                    shadowRadius: 4,
                    shadowOffset: { width: 0, height: 2 },
                    elevation: 2,
                  },
                  pressed && { opacity: 0.8 },
                ]}
                onPress={() => setScannerMode(m)}
              >
                <Text
                  style={[
                    s.modePillText,
                    { color: scannerMode === m ? C.text : C.textSub },
                  ]}
                >
                  {m === "auto" ? t("auto") : t("manual")}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>

      {/* ── AUTO MODE ── */}
      {scannerMode === "auto" && (
        <View style={s.fill}>
          {/* Camera */}
          <View style={[s.cameraWrap]}>
            <CameraView
              style={StyleSheet.absoluteFillObject}
              barcodeScannerSettings={{
                barcodeTypes: ["ean13", "ean8", "qr", "upc_a", "upc_e"],
              }}
              onBarcodeScanned={
                scanned
                  ? undefined
                  : ({ type, data }) => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setDatatype(type);
                      setEan(data);
                      setScanned(true);
                    }
              }
            />

            {/* Cancel / Repoint Camera button positioned OVER the camera instead of squished */}
            {scanned && (
              <View style={s.cancelScanWrap}>
                <Pressable
                  style={({ pressed }) => [
                    s.abortBtn,
                    pressed && { opacity: 0.7 },
                  ]}
                  disabled={sending}
                  onPress={() => {
                    Haptics.selectionAsync();
                    resetAutoScan();
                  }}
                >
                  <Text style={s.abortBtnText}>{t("abort")}</Text>
                </Pressable>
              </View>
            )}

            {/* Corner guides */}
            {!scanned && (
              <>
                <View style={[s.overlay, { backgroundColor: C.scanOverlay }]} />
                <View style={s.cutout} />
                {/* Corner marks */}
                {[
                  {
                    top: "20%",
                    left: "10%",
                    borderTopWidth: 4,
                    borderLeftWidth: 4,
                  },
                  {
                    top: "20%",
                    right: "10%",
                    borderTopWidth: 4,
                    borderRightWidth: 4,
                  },
                  {
                    bottom: "40%",
                    left: "10%",
                    borderBottomWidth: 4,
                    borderLeftWidth: 4,
                  },
                  {
                    bottom: "40%",
                    right: "10%",
                    borderBottomWidth: 4,
                    borderRightWidth: 4,
                  },
                ].map((style, i) => (
                  <View
                    key={i}
                    style={[s.corner, style as any, { borderColor: C.corner }]}
                  />
                ))}
                <Text
                  style={[
                    s.scanHint,
                    { backgroundColor: C.glass, color: C.text },
                  ]}
                >
                  {t("pointCamera")}
                </Text>
              </>
            )}
          </View>

          {/* Bottom sheet after scan */}
          {scanned && (
            <View
              style={[
                s.sheet,
                { backgroundColor: C.surface, borderColor: C.border },
              ]}
            >
              <View style={[s.sheetHandle, { backgroundColor: C.border }]} />

              <View style={s.eanRow}>
                <View style={s.eanTextCol}>
                  <Text style={[s.eanType, { color: C.textMuted }]}>
                    {datatype.toUpperCase()}
                  </Text>
                  <Text
                    style={[s.eanValue, { color: C.text }]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                  >
                    {ean}
                  </Text>
                </View>
              </View>

              {/* Count stepper */}
              <View style={s.stepperRow}>
                <Text style={[s.stepperLabel, { color: C.textSub }]}>
                  {t("units")}
                </Text>
                <View style={[s.stepper, { backgroundColor: C.surfaceAlt }]}>
                  <Pressable
                    style={({ pressed }) => [
                      s.stepBtn,
                      pressed && { backgroundColor: C.pill },
                      count <= 1 && { opacity: 0.3 },
                    ]}
                    disabled={count <= 1}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setCount((p) => Math.max(1, p - 1));
                    }}
                  >
                    <Text style={[s.stepBtnText, { color: C.text }]}>−</Text>
                  </Pressable>
                  <Text style={[s.stepCount, { color: C.text }]}>{count}</Text>
                  <Pressable
                    style={({ pressed }) => [
                      s.stepBtn,
                      pressed && { backgroundColor: C.pill },
                    ]}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setCount((p) => p + 1);
                    }}
                  >
                    <Text style={[s.stepBtnText, { color: C.text }]}>+</Text>
                  </Pressable>
                </View>
              </View>

              {/* Action buttons */}
              <View style={s.actions}>
                <Pressable
                  style={({ pressed }) => [
                    s.btnPrimary,
                    { backgroundColor: C.accent },
                    pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
                    sending && { opacity: 0.5 },
                  ]}
                  disabled={sending}
                  onPress={() => submitEan("add")}
                >
                  <Text
                    style={[s.btnPrimaryText, sending && { color: C.textSub }]}
                  >
                    {sending ? t("working") : `${t("addBtn")} ${count}`}
                  </Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [
                    s.btnDanger,
                    {
                      backgroundColor: C.dangerBg,
                      borderColor: C.dangerBorder,
                    },
                    pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
                    sending && { opacity: 0.5 },
                  ]}
                  disabled={sending}
                  onPress={() => submitEan("remove")}
                >
                  <Text
                    style={[
                      s.btnDangerText,
                      { color: C.dangerText },
                      sending && { color: C.textSub },
                    ]}
                  >
                    {sending ? t("working") : `${t("removeBtn")} ${count}`}
                  </Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      )}

      {/* ── MANUAL MODE ── */}
      {scannerMode === "manual" && (
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={[s.fill, { backgroundColor: C.surfaceAlt }]}
        >
          <ScrollView
            style={s.fill}
            contentContainerStyle={s.manualScroll}
            keyboardShouldPersistTaps="handled"
          >
            <View
              style={[
                s.card,
                {
                  backgroundColor: C.surface,
                  shadowColor: "#000",
                  shadowOpacity: 0.03,
                  shadowRadius: 10,
                  shadowOffset: { width: 0, height: 4 },
                  elevation: 2,
                },
              ]}
            >
              {/* Tab switcher */}
              <View style={[s.tabs, { backgroundColor: C.surfaceAlt }]}>
                {(["name", "barcode"] as ManualTab[]).map((tab) => (
                  <Pressable
                    key={tab}
                    style={({ pressed }) => [
                      s.tabItem,
                      manualTab === tab && [
                        s.tabItemActive,
                        {
                          backgroundColor: C.surface,
                          shadowColor: "#000",
                          shadowOpacity: 0.05,
                          shadowRadius: 4,
                          shadowOffset: { width: 0, height: 2 },
                          elevation: 2,
                        },
                      ],
                      pressed && { opacity: 0.8 },
                    ]}
                    onPress={() => setManualTab(tab)}
                  >
                    <Text
                      style={[
                        s.tabText,
                        { color: manualTab === tab ? C.text : C.textSub },
                      ]}
                    >
                      {tab === "name" ? t("byName") : t("byBarcode")}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {/* Name tab */}
              {manualTab === "name" && (
                <View style={s.fieldGroup}>
                  <Text style={[s.fieldLabel, { color: C.text }]}>
                    {t("itemName")}
                  </Text>
                  <TextInput
                    style={[
                      s.textInput,
                      {
                        backgroundColor: C.surfaceAlt,
                        color: C.text,
                        borderColor: manualName ? C.borderFocus : "transparent",
                      },
                    ]}
                    placeholder={t("namePlaceholder")}
                    placeholderTextColor={C.textMuted}
                    value={manualName}
                    onChangeText={setManualName}
                    autoCapitalize="none"
                    returnKeyType="done"
                  />
                </View>
              )}

              {/* Barcode tab */}
              {manualTab === "barcode" && (
                <View style={s.fieldGroup}>
                  <Text style={[s.fieldLabel, { color: C.text }]}>
                    {t("barcodeLabel")}
                  </Text>
                  <TextInput
                    style={[
                      s.textInput,
                      {
                        backgroundColor: C.surfaceAlt,
                        color: C.text,
                        borderColor: manualBarcode
                          ? C.borderFocus
                          : "transparent",
                        fontVariant: ["tabular-nums"],
                        letterSpacing: 1,
                      },
                    ]}
                    placeholder={t("barcodePlaceholder")}
                    placeholderTextColor={C.textMuted}
                    value={manualBarcode}
                    onChangeText={(v) =>
                      setManualBarcode(v.replace(/\D/g, "").slice(0, 14))
                    }
                    keyboardType="number-pad"
                    maxLength={14}
                    returnKeyType="done"
                  />
                  <Text style={[s.fieldHint, { color: C.textMuted }]}>
                    {manualBarcode.length} / 14 {t("digits")}
                  </Text>
                </View>
              )}

              {/* Count stepper */}
              <View style={s.stepperRow}>
                <Text style={[s.stepperLabel, { color: C.text }]}>
                  {t("units")}
                </Text>
                <View style={[s.stepper, { backgroundColor: C.surfaceAlt }]}>
                  <Pressable
                    style={({ pressed }) => [
                      s.stepBtn,
                      pressed && { backgroundColor: C.pill },
                      count <= 1 && { opacity: 0.3 },
                    ]}
                    disabled={count <= 1}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setCount((p) => Math.max(1, p - 1));
                    }}
                  >
                    <Text style={[s.stepBtnText, { color: C.text }]}>−</Text>
                  </Pressable>
                  <Text style={[s.stepCount, { color: C.text }]}>{count}</Text>
                  <Pressable
                    style={({ pressed }) => [
                      s.stepBtn,
                      pressed && { backgroundColor: C.pill },
                    ]}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setCount((p) => p + 1);
                    }}
                  >
                    <Text style={[s.stepBtnText, { color: C.text }]}>+</Text>
                  </Pressable>
                </View>
              </View>

              {/* Action buttons */}
              <View style={s.actions}>
                {(() => {
                  const isValid =
                    manualTab === "name"
                      ? manualName.trim().length > 0
                      : manualBarcode.length >= 8;
                  const onAdd = () =>
                    manualTab === "name"
                      ? submitManualName("add")
                      : submitManualBarcode("add");
                  const onRemove = () =>
                    manualTab === "name"
                      ? submitManualName("remove")
                      : submitManualBarcode("remove");

                  return (
                    <>
                      <Pressable
                        style={({ pressed }) => [
                          s.btnPrimary,
                          { backgroundColor: isValid ? C.accent : C.pill },
                          pressed &&
                            isValid && {
                              opacity: 0.85,
                              transform: [{ scale: 0.98 }],
                            },
                          (!isValid || sending) && { opacity: 0.5 },
                        ]}
                        disabled={!isValid || sending}
                        onPress={onAdd}
                      >
                        <Text
                          style={[
                            s.btnPrimaryText,
                            !isValid && { color: C.textSub },
                          ]}
                        >
                          {sending ? t("working") : `${t("addBtn")} ${count}`}
                        </Text>
                      </Pressable>
                      <Pressable
                        style={({ pressed }) => [
                          s.btnDanger,
                          {
                            backgroundColor: isValid ? C.dangerBg : C.pill,
                            borderColor: isValid
                              ? C.dangerBorder
                              : "transparent",
                          },
                          pressed &&
                            isValid && {
                              opacity: 0.85,
                              transform: [{ scale: 0.98 }],
                            },
                          (!isValid || sending) && { opacity: 0.5 },
                        ]}
                        disabled={!isValid || sending}
                        onPress={onRemove}
                      >
                        <Text
                          style={[
                            s.btnDangerText,
                            { color: isValid ? C.dangerText : C.textSub },
                          ]}
                        >
                          {sending
                            ? t("working")
                            : `${t("removeBtn")} ${count}`}
                        </Text>
                      </Pressable>
                    </>
                  );
                })()}
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      {/* ── TOAST ── */}
      {toast && (
        <Animated.View
          style={[
            s.toast,
            toast.success
              ? { backgroundColor: C.toastSuccessBg }
              : { backgroundColor: C.toastErrorBg },
            { opacity: toastOpacity },
          ]}
          pointerEvents="none"
        >
          <Text style={{ fontSize: 15 }}>{toast.success ? "✓" : "✕"}</Text>
          <Text
            style={[
              s.toastText,
              { color: toast.success ? C.toastSuccessText : C.toastErrorText },
            ]}
          >
            {toast.message}
          </Text>
        </Animated.View>
      )}

      {/* ── QUANTITY MODAL ── */}
      <QuantityModal
        visible={qtyModal.visible}
        productName={qtyModal.productName}
        t={t}
        C={C}
        onSave={handleQtyModalSave}
        onCancel={handleQtyModalCancel}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  fill: { flex: 1 },
  center: { justifyContent: "center", alignItems: "center" },

  // Permission
  permTitle: { fontSize: 22, fontWeight: "700", marginBottom: 8 },
  permBody: { fontSize: 15, textAlign: "center", marginBottom: 24 },
  permBtn: {
    paddingVertical: 13,
    paddingHorizontal: 28,
    borderRadius: 14,
  },
  permBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },

  // Header
  header: {
    paddingTop: Platform.OS === "ios" ? 56 : 16,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    zIndex: 10,
  },
  headerTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
  },
  backBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  backBtnText: { fontSize: 13, fontWeight: "600" },
  backBtnPlaceholder: {
    width: 64, // Matches approx. width of backBtn to help center title naturally
  },
  headerCenter: {
    flex: 1,
    flexDirection: "column", // Stacks "Add / Remove" and the Badge vertically
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  headerTitle: { fontSize: 18, fontWeight: "700" },
  listBadge: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  listBadgeText: { fontSize: 11, fontWeight: "700" },

  // Mode pill (Auto/Manual)
  headerToggleWrap: {
    paddingHorizontal: 16,
    marginTop: 18,
    alignItems: "center",
  },
  modePill: {
    flexDirection: "row",
    borderRadius: 14,
    padding: 3,
    width: "100%",
    maxWidth: 340,
    gap: 4,
  },
  modePillItem: {
    flex: 1,
    paddingVertical: 8,
    alignItems: "center",
    borderRadius: 12,
  },
  modePillText: { fontSize: 13, fontWeight: "600" },

  // Camera
  cameraWrap: {
    flex: 1,
    overflow: "hidden",
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  cutout: {
    position: "absolute",
    top: "20%",
    left: "10%",
    right: "10%",
    bottom: "40%",
    backgroundColor: "transparent",
    borderRadius: 24,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.1)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
  },
  corner: {
    position: "absolute",
    width: 32,
    height: 32,
    borderColor: "white",
    borderRadius: 8,
  },
  scanHint: {
    position: "absolute",
    top: "12%",
    alignSelf: "center",
    fontSize: 14,
    fontWeight: "700",
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 30,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
  },

  // Bottom sheet (auto mode after scan)
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingTop: 14,
    paddingBottom: Platform.OS === "ios" ? 40 : 24,
    paddingHorizontal: 24,
    gap: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 20,
  },
  sheetHandle: {
    width: 48,
    height: 5,
    borderRadius: 3,
    alignSelf: "center",
    marginBottom: 4,
  },
  eanRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  eanTextCol: {
    flex: 1,
    paddingRight: 16,
  },
  eanType: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 1,
    marginBottom: 2,
  },
  eanValue: {
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: 1.5,
    fontVariant: ["tabular-nums"],
  },
  cancelScanWrap: {
    position: "absolute",
    top: 20,
    right: 20,
    zIndex: 20,
  },
  abortBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    borderColor: "rgba(255,255,255,0.1)",
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
  },
  abortBtnText: { fontSize: 13, fontWeight: "700", color: "#fff" },

  // Stepper
  stepperRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 8,
    marginBottom: 12,
  },
  stepperLabel: { fontSize: 15, fontWeight: "600" },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    gap: 4,
    padding: 4,
  },
  stepBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  stepBtnText: { fontSize: 24, fontWeight: "500", lineHeight: 28 },
  stepCount: {
    minWidth: 40,
    textAlign: "center",
    fontSize: 18,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },

  // Buttons
  actions: { flexDirection: "row", gap: 12, marginTop: 8 },
  btnPrimary: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: "center",
  },
  btnPrimaryText: { fontSize: 16, fontWeight: "700", color: "#fff" },
  btnDanger: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
  },
  btnDangerText: { fontSize: 16, fontWeight: "700" },

  // Manual
  manualScroll: { padding: 16, paddingTop: 24, paddingBottom: 60, gap: 16 },
  card: {
    borderRadius: 24,
    padding: 24,
    gap: 24,
    borderWidth: 0,
  },
  tabs: {
    flexDirection: "row",
    borderRadius: 14,
    padding: 4,
    gap: 0,
    marginBottom: 8,
  },
  tabItem: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: "center",
  },
  tabItemActive: {},
  tabText: { fontSize: 13, fontWeight: "600" },

  fieldGroup: { gap: 10 },
  fieldLabel: { fontSize: 14, fontWeight: "600" },
  textInput: {
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 15,
    paddingHorizontal: 16,
    fontSize: 16,
  },
  fieldHint: { fontSize: 12, textAlign: "right", marginTop: 2, marginRight: 4 },

  // Toast
  toast: {
    position: "absolute",
    top: Platform.OS === "ios" ? 110 : 72,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: 14,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
    maxWidth: "88%",
  },
  toastText: { fontSize: 13, fontWeight: "600", flexShrink: 1 },
});
