package io.forgepay.killbill;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.UUID;

/**
 * Generates deterministic, idempotent keys for payment requests.
 * Ensures that duplicate requests (network retries) result in same payment.
 *
 * Key format: {merchantId}-{invoiceId}-{operationType}-{hash}
 * Where hash = SHA256(merchantId + invoiceId + operationType)
 */
public class IdempotencyKeyGenerator {

    private static final int MAX_KEY_LENGTH = 64; // Hyperswitch limitation

    /**
     * Generates an idempotency key from payment identifiers.
     * Idempotency keys are deterministic: same inputs always produce same key.
     *
     * @param customerId Customer/merchant ID
     * @param paymentId Invoice/payment ID
     * @param operationType Operation type (authorize, capture, refund, void)
     * @return Unique, deterministic idempotency key
     */
    public String generate(UUID customerId, UUID paymentId, String operationType) {
        String input = customerId.toString() + "-" + paymentId.toString() + "-" + operationType;
        String hash = sha256(input).substring(0, 16);
        String key = customerId.toString() + "-" + operationType + "-" + hash;

        // Ensure key doesn't exceed maximum length
        if (key.length() > MAX_KEY_LENGTH) {
            return key.substring(0, MAX_KEY_LENGTH);
        }

        return key;
    }

    /**
     * Generates SHA256 hash of input string.
     *
     * @param input String to hash
     * @return Hex-encoded SHA256 hash
     */
    private String sha256(String input) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(input.getBytes(StandardCharsets.UTF_8));
            return bytesToHex(hash);
        } catch (NoSuchAlgorithmException e) {
            // Fallback to simple hash if SHA256 unavailable
            return Integer.toHexString(input.hashCode());
        }
    }

    /**
     * Converts byte array to hex string.
     */
    private String bytesToHex(byte[] bytes) {
        StringBuilder hexString = new StringBuilder();
        for (byte b : bytes) {
            String hex = Integer.toHexString(0xff & b);
            if (hex.length() == 1) {
                hexString.append('0');
            }
            hexString.append(hex);
        }
        return hexString.toString();
    }
}
