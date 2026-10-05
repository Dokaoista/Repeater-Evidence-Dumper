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
 * Observa toda requisicao/resposta que passa pela aba Repeater do Burp e grava
 * o par request/response em texto cru dentro de ~/burp-evidence/inbox, pronto
 * para o renderizador shot.mjs transformar em PNG.
 *
 * NOTA: a Montoya API (2025.5, a mais recente publicada) nao expõe um metodo
 * para enumerar as abas abertas do Repeater nem ler o estado atual de uma aba
 * (nao existe Repeater.repeaterTabs() ou RepeaterTab). O pacote burp.api.montoya.repeater
 * so tem Repeater.sendToRepeater(...). Por isso a captura é orientada a evento
 * (HttpHandler, dispara a cada "Send" real) em vez de polling a cada 3s —
 * funcionalmente equivalente (ou melhor: zero atraso) para o objetivo de gerar
 * evidência, mas não é uma leitura passiva do estado das abas.
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
            api.logging().logToError("Nao foi possivel criar " + INBOX + ": " + e.getMessage());
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
                        api.logging().logToError("Falha ao gravar evidencia do Repeater", e);
                    }
                }
                return ResponseReceivedAction.continueWith(responseReceived);
            }
        });

        // Fallback manual: botao direito dentro do editor de request/response de uma aba
        // Repeater -> "Dump Repeater tab now (evidence)". Util quando a aba ainda nao foi
        // enviada (so grava o request) ou para forcar uma nova captura pontual.
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
                        api.logging().logToError("Falha no dump manual", ex);
                    }
                });
                return List.of(item);
            }
        });

        api.logging().logToOutput("Repeater Evidence Dumper carregado. Gravando em " + INBOX);
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
        api.logging().logToOutput("Evidencia gravada: " + name);
    }
}
