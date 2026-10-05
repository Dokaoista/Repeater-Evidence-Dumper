package com.dokaoista.evidence;

import burp.api.montoya.BurpExtension;
import burp.api.montoya.MontoyaApi;
import burp.api.montoya.core.ToolType;
import burp.api.montoya.http.handler.HttpHandler;
import burp.api.montoya.http.handler.HttpRequestToBeSent;
import burp.api.montoya.http.handler.HttpResponseReceived;
import burp.api.montoya.http.handler.RequestToBeSentAction;
import burp.api.montoya.http.handler.ResponseReceivedAction;
import burp.api.montoya.http.message.HttpRequestResponse;
import burp.api.montoya.http.message.requests.HttpRequest;
import burp.api.montoya.http.message.responses.HttpResponse;
import burp.api.montoya.ui.contextmenu.ContextMenuEvent;
import burp.api.montoya.ui.contextmenu.ContextMenuItemsProvider;
import burp.api.montoya.ui.contextmenu.MessageEditorHttpRequestResponse;

import javax.swing.JMenuItem;
import java.awt.Component;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardOpenOption;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Pattern;

/**
 * Watches every request/response going through Burp's Repeater and writes the
 * pair as raw text into ~/burp-evidence/inbox, ready for the shot.mjs renderer
 * to turn into a PNG.
 *
 * NOTE: the Montoya API (2025.5, the latest published) exposes no method to
 * enumerate the open Repeater tabs nor to read a tab's current state (there is
 * no Repeater.repeaterTabs() or RepeaterTab). The burp.api.montoya.repeater
 * package only offers Repeater.sendToRepeater(...). Capture is therefore
 * event driven (HttpHandler, firing on every real "Send") instead of polling
 * every 3s. For the goal of generating evidence that is functionally
 * equivalent, or better since there is zero lag, but it is not a passive read
 * of tab state.
 */
public class RepeaterDumpExtension implements BurpExtension {

    private static final Path INBOX = Paths.get(System.getProperty("user.home"), "burp-evidence", "inbox");
    private static final Pattern UNSAFE_CHARS = Pattern.compile("[^a-zA-Z0-9]+");

    private final AtomicInteger manualCounter = new AtomicInteger(0);
    private MontoyaApi api;

    @Override
    public void initialize(MontoyaApi api) {
        this.api = api;
        api.extension().setName("Repeater Evidence Dumper");

        try {
            Files.createDirectories(INBOX);
        } catch (IOException e) {
            api.logging().logToError("Could not create " + INBOX + ": " + e.getMessage());
        }

        api.http().registerHttpHandler(new HttpHandler() {
            @Override
            public RequestToBeSentAction handleHttpRequestToBeSent(HttpRequestToBeSent requestToBeSent) {
                return RequestToBeSentAction.continueWith(requestToBeSent);
            }

            @Override
            public ResponseReceivedAction handleHttpResponseReceived(HttpResponseReceived responseReceived) {
                if (responseReceived.toolSource().isFromTool(ToolType.REPEATER)) {
                    try {
                        dumpAuto(responseReceived.messageId(), responseReceived.initiatingRequest(), responseReceived);
                    } catch (Exception e) {
                        api.logging().logToError("Failed to write Repeater evidence", e);
                    }
                }
                return ResponseReceivedAction.continueWith(responseReceived);
            }
        });

        // Manual fallback: right-click inside the request/response editor of a Repeater
        // tab -> "Dump Repeater tab now (evidence)". Useful when the tab has not been
        // sent yet (captures the request only) or to force a one-off capture.
        api.userInterface().registerContextMenuItemsProvider(new ContextMenuItemsProvider() {
            @Override
            public List<Component> provideMenuItems(ContextMenuEvent event) {
                if (event.toolType() != ToolType.REPEATER) {
                    return List.of();
                }
                Optional<MessageEditorHttpRequestResponse> editorRR = event.messageEditorRequestResponse();
                if (editorRR.isEmpty()) {
                    return List.of();
                }
                JMenuItem item = new JMenuItem("Dump Repeater tab now (evidence)");
                item.addActionListener(e -> {
                    HttpRequestResponse rr = editorRR.get().requestResponse();
                    try {
                        dumpManual(rr.request(), rr.hasResponse() ? rr.response() : null);
                    } catch (Exception ex) {
                        api.logging().logToError("Manual dump failed", ex);
                    }
                });
                return List.of(item);
            }
        });

        api.logging().logToOutput("Repeater Evidence Dumper loaded. Writing to " + INBOX);
    }

    private void dumpAuto(int messageId, HttpRequest request, HttpResponse response) throws IOException {
        String name = String.format("%05d-%s", messageId, sanitize(request));
        writePair(name, request.toString(), response == null ? "" : response.toString());
    }

    private void dumpManual(HttpRequest request, HttpResponse response) throws IOException {
        String name = String.format("manual-%05d-%s", manualCounter.incrementAndGet(), sanitize(request));
        writePair(name, request.toString(), response == null ? "" : response.toString());
    }

    private String sanitize(HttpRequest request) {
        String raw = request.method() + "-" + request.path();
        String cleaned = UNSAFE_CHARS.matcher(raw).replaceAll("-").toLowerCase();
        cleaned = cleaned.replaceAll("^-+|-+$", "");
        if (cleaned.length() > 60) cleaned = cleaned.substring(0, 60);
        if (cleaned.isEmpty()) cleaned = "request";
        return cleaned;
    }

    private void writePair(String name, String requestText, String responseText) throws IOException {
        Path reqFile = INBOX.resolve(name + ".request.txt");
        Path respFile = INBOX.resolve(name + ".response.txt");
        Files.writeString(reqFile, requestText, StandardCharsets.UTF_8,
                StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING);
        Files.writeString(respFile, responseText, StandardCharsets.UTF_8,
                StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING);
        api.logging().logToOutput("Evidence written: " + name);
    }
}
