// Buzzer test — cycles through HIGH and LOW to find which triggers your module

#define BUZZER_PIN 19

void setup() {
  Serial.begin(115200);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);
  Serial.println("\n=== Buzzer Test ===\n");
}

void loop() {
  Serial.println("Buzzer HIGH (active HIGH test)...");
  digitalWrite(BUZZER_PIN, HIGH);
  delay(2000);

  Serial.println("Buzzer OFF");
  digitalWrite(BUZZER_PIN, LOW);
  delay(1000);

  Serial.println("Buzzer LOW (active LOW test)...");
  digitalWrite(BUZZER_PIN, LOW);
  delay(2000);

  Serial.println("Buzzer OFF (HIGH)");
  digitalWrite(BUZZER_PIN, HIGH);
  delay(1000);

  Serial.println("--- Cycle done, repeating ---\n");
}
