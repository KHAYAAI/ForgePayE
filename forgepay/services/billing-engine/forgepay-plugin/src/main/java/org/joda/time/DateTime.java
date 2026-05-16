package org.joda.time;

/**
 * DateTime mock class for local development/testing.
 * In production, use actual Joda Time library.
 */
public class DateTime {
    public static DateTime now() {
        return new DateTime();
    }
}
