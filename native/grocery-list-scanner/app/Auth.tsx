import { useNavigation } from "@react-navigation/native";
import React, { useMemo, useState, useEffect } from "react";
import {
  Appearance,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { useAuthSession } from "../lib/AuthSession";
import { mobileApiUrl } from "../lib/config";
import { loginForAccessToken, MOBILE_API_PATHS } from "../lib/api";

type ColorScheme = "dark" | "light";

export default function Auth() {
  const navigation = useNavigation<any>();
  const { setSession } = useAuthSession();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [colorScheme, setColorScheme] = useState<ColorScheme>(
    Appearance.getColorScheme() === "light" ? "light" : "dark",
  );

  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme: cs }) => {
      setColorScheme(cs === "light" ? "light" : "dark");
    });
    return () => sub.remove();
  }, []);

  const isLight = colorScheme === "light";

  const C = {
    bg: isLight ? "#8d8d8d" : "#1d1d21",
    modalBg: isLight ? "#ffffff" : "#1f1f24",
    textBold: isLight ? "#111827" : "#e5e7eb",
    textSub: isLight ? "#4b5563" : "#9ca3af",
    labelText: isLight ? "#374151" : "#d1d5db",
    inputBg: isLight ? "#f0eee2" : "#19191d",
    inputBorder: isLight ? "#e5e3d8" : "#2d2d34",
    inputText: isLight ? "#374151" : "#e5e7eb",
    btnBg: "#5c5cf2",
    btnText: "#ffffff",
    iconBg: "#5c5cf2",
    demoText: isLight ? "#6b7280" : "#6b7280",
  };

  const canSubmit = useMemo(
    () => username.trim().length > 0 && password.length > 0 && !isSubmitting,
    [isSubmitting, password, username],
  );

  const signIn = async () => {
    if (!canSubmit) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const payload = await loginForAccessToken(username.trim(), password);

      if (!payload.access_token) {
        throw new Error("Missing access token");
      }

      setSession(`Bearer ${payload.access_token}`, username.trim());
      navigation.reset({ index: 0, routes: [{ name: "scanner" }] });
    } catch (err) {
      console.error("Auth error", err);
      setError("Sign in failed. Check username, password and server URL.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: C.bg }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <View style={styles.scrollContent}>
          <View style={[styles.card, { backgroundColor: C.modalBg }]}>
            {/* Header / Logo */}
            <View style={styles.headerWrap}>
              <View style={[styles.iconWrap, { backgroundColor: C.iconBg }]}>
                <Text style={styles.iconEmoji}>🛒</Text>
              </View>
              <View style={styles.headerTextWrap}>
                <Text style={[styles.title, { color: C.textBold }]}>
                  Anmelden
                </Text>
                <Text style={[styles.subtitle, { color: C.textSub }]}>
                  Ihre Sitzung ist abgelaufen. Bitte authentifizieren Sie sich
                  erneut.
                </Text>
              </View>
            </View>

            {/* Form */}
            <View style={styles.formGroup}>
              <Text style={[styles.label, { color: C.labelText }]}>
                Benutzername
              </Text>
              <TextInput
                value={username}
                onChangeText={setUsername}
                placeholder="username"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
                style={[
                  styles.input,
                  {
                    backgroundColor: C.inputBg,
                    borderColor: C.inputBorder,
                    color: C.inputText,
                  },
                ]}
                placeholderTextColor={isLight ? "#9ca3af" : "#6b7280"}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={[styles.label, { color: C.labelText }]}>
                Password
              </Text>
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="password"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="go"
                onSubmitEditing={signIn}
                style={[
                  styles.input,
                  {
                    backgroundColor: C.inputBg,
                    borderColor: C.inputBorder,
                    color: C.inputText,
                  },
                ]}
                placeholderTextColor={isLight ? "#9ca3af" : "#6b7280"}
              />
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            {/* Button */}
            <Pressable
              onPress={signIn}
              disabled={!canSubmit}
              style={({ pressed }) => [
                styles.primaryBtn,
                { backgroundColor: C.btnBg },
                pressed && { opacity: 0.85 },
                !canSubmit && { opacity: 0.45 },
              ]}
            >
              <Text style={styles.primaryBtnText}>
                {isSubmitting ? "Laden..." : "Fortfahren"}
              </Text>
            </Pressable>

            {/* Footer */}
            <Text style={[styles.demoHint, { color: C.demoText }]}>
              Demo:{" "}
              <Text
                style={{
                  fontWeight: "700",
                  color: isLight ? "#374151" : "#d1d5db",
                }}
              >
                demo
              </Text>{" "}
              /{" "}
              <Text
                style={{
                  fontWeight: "700",
                  color: isLight ? "#374151" : "#d1d5db",
                }}
              >
                demo
              </Text>
            </Text>

            <Text
              style={[
                styles.serverText,
                { color: isLight ? "#9ca3af" : "#4b5563" },
              ]}
            >
              {mobileApiUrl(MOBILE_API_PATHS.token)}
            </Text>
          </View>
        </View>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
  },
  scrollContent: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  card: {
    width: "100%",
    maxWidth: 440,
    borderRadius: 24,
    padding: 30,
    gap: 20,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 30,
    elevation: 10,
  },
  headerWrap: {
    flexDirection: "row",
    gap: 16,
    marginBottom: 4,
    alignItems: "flex-start",
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  iconEmoji: {
    fontSize: 24,
  },
  headerTextWrap: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontFamily: Platform.OS === "ios" ? "Georgia" : "serif",
    fontSize: 26,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
  },
  formGroup: {
    gap: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: "700",
    marginLeft: 2,
  },
  input: {
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 15,
  },
  error: {
    fontSize: 13,
    color: "#fca5a5",
    textAlign: "center",
    marginTop: -8,
  },
  primaryBtn: {
    marginTop: 8,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
  },
  primaryBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  demoHint: {
    marginTop: 4,
    textAlign: "center",
    fontSize: 13,
  },
  serverText: {
    textAlign: "center",
    fontSize: 10,
    opacity: 0.6,
  },
});
