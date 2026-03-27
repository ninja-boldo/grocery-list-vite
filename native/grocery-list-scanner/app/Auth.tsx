import { useNavigation } from "@react-navigation/native";
import React, { useMemo, useState } from "react";
import {
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

const encodeForm = (username: string, password: string) =>
  `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;

export default function Auth() {
  const navigation = useNavigation<any>();
  const { setSession } = useAuthSession();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = useMemo(
    () => username.trim().length > 0 && password.length > 0 && !isSubmitting,
    [isSubmitting, password, username],
  );

  const signIn = async () => {
    if (!canSubmit) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch(mobileApiUrl("/token"), {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: encodeForm(username.trim(), password),
      });

      if (!response.ok) {
        throw new Error(`Login failed (${response.status})`);
      }

      const payload = (await response.json()) as {
        access_token?: string;
      };

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
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 24 : 0}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.card}>
            <Text style={styles.title}>Sign in</Text>
            <Text style={styles.subtitle}>
              Authenticate against your API server.
            </Text>

            <TextInput
              value={username}
              onChangeText={setUsername}
              placeholder="Username"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="next"
              style={styles.input}
              placeholderTextColor="#4d5566"
            />

            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="go"
              onSubmitEditing={signIn}
              style={styles.input}
              placeholderTextColor="#4d5566"
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              onPress={signIn}
              disabled={!canSubmit}
              style={({ pressed }) => [
                styles.primaryBtn,
                pressed && { opacity: 0.85 },
                !canSubmit && { opacity: 0.45 },
              ]}
            >
              <Text style={styles.primaryBtnText}>
                {isSubmitting ? "Signing in..." : "Sign in"}
              </Text>
            </Pressable>

            <Text style={styles.demoHint}>
              Demo access: <Text style={styles.demoHintStrong}>demo</Text> /{" "}
              <Text style={styles.demoHintStrong}>demo</Text>
            </Text>

            <Text style={styles.serverText}>
              Login URL: {mobileApiUrl("/token")}
            </Text>
          </View>
        </ScrollView>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0d1117",
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 10,
    paddingVertical: 24,
  },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#0d948850",
    backgroundColor: "#161b22",
    padding: 18,
    gap: 10,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: "#5eead4",
  },
  subtitle: {
    fontSize: 13,
    color: "#8b949e",
    marginBottom: 6,
  },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#21262d",
    backgroundColor: "#0d1117",
    color: "#e6edf3",
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  error: {
    fontSize: 12,
    color: "#fca5a5",
  },
  primaryBtn: {
    marginTop: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#0d948850",
    backgroundColor: "#0f2a28",
    paddingVertical: 11,
    alignItems: "center",
  },
  primaryBtnText: {
    color: "#5eead4",
    fontSize: 14,
    fontWeight: "700",
  },
  demoHint: {
    marginTop: 4,
    textAlign: "center",
    fontSize: 11,
    color: "#8b949ec0",
  },
  demoHintStrong: {
    color: "#e6edf3d0",
    fontWeight: "600",
  },
  serverText: {
    marginTop: 8,
    fontSize: 11,
    color: "#6e7681",
  },
});
