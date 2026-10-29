import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Shell } from "@/components/shell";
import { api } from "@/lib/api";
import { CandidatoDetailPage } from "@/pages/CandidatoDetailPage";
import { CandidatoFormPage } from "@/pages/CandidatoFormPage";
import { CandidatosPage } from "@/pages/CandidatosPage";
import { ConfiguracoesPage } from "@/pages/ConfiguracoesPage";
import { ContratacaoDetailPage } from "@/pages/ContratacaoDetailPage";
import { ContratacoesPage } from "@/pages/ContratacoesPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { EmailsPage } from "@/pages/EmailsPage";
import { EmpresaDetailPage } from "@/pages/EmpresaDetailPage";
import { EmpresaFormPage } from "@/pages/EmpresaFormPage";
import { EmpresasPage } from "@/pages/EmpresasPage";
import { GruposEmpresasPage } from "@/pages/GruposEmpresasPage";
import { ComissaoConsultarPage, ComissaoEmpresasPage, GerarFaturamentoPage, GerarHoleritePage, RelatorioProcfyPage } from "@/pages/FinanceiroPage";
import { ContasReceberPage } from "@/pages/ContasReceberPage";
import { ReguaCobrancaPage } from "@/pages/ReguaCobrancaPage";
import { LoginPage } from "@/pages/LoginPage";
import { CadastrarInstituicaoPage, ConsultarInstituicoesPage, ConsultarModelosPage, DocumentosPendentesPage } from "@/pages/NovasAbasPage";
import { NovaContratacaoPage } from "@/pages/NovaContratacaoPage";
import { ProcessoDetailPage } from "@/pages/ProcessoDetailPage";
import { ProcessoFormPage } from "@/pages/ProcessoFormPage";
import { ProcessosPage } from "@/pages/ProcessosPage";
import { RescisaoDetailPage } from "@/pages/RescisaoDetailPage";
import { RescisaoPage } from "@/pages/RescisaoPage";
import { VagaDetailPage } from "@/pages/VagaDetailPage";
import { VagaFormPage } from "@/pages/VagaFormPage";
import { TermoDetailPage } from "@/pages/TermoDetailPage";
import { GerarDocumentoPage } from "@/pages/GerarDocumentoPage";
import { GerarTcePage, TermosPage } from "@/pages/TermosPage";
import { TriagemPage } from "@/pages/TriagemPage";
import { VagasPage } from "@/pages/VagasPage";

const client = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

function Toast({ message, error }: { message: string; error?: boolean }) {
  if (!message) return null;
  return <div role="status" className={`fixed bottom-4 right-4 z-50 max-w-sm rounded-2xl px-4 py-3 text-sm font-semibold text-white shadow-lg ${error ? "bg-rose-600" : "bg-navy-900"}`}>{message}</div>;
}

function Protected() {
  const [toast, setToast] = useState<{ message: string; error?: boolean }>({ message: "" });
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ email: string; admin: boolean; paginas: string[] }>("/api/v1/auth/me"), retry: false });
  if (me.isLoading) return <div className="grid min-h-screen place-items-center text-sm text-slate-500">Carregando sessão…</div>;
  if (me.isError) return <Navigate to="/login" replace />;
  return (
    <>
      <Shell email={me.data?.data.email ?? ""} admin={me.data?.data.admin === true} paginas={me.data?.data.paginas ?? []} notify={(message, error) => { setToast({ message, error }); setTimeout(() => setToast({ message: "" }), 3200); }} />
      <Toast message={toast.message} error={toast.error} />
    </>
  );
}

export function App() {
  return (
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<Protected />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/triagem" element={<TriagemPage />} />
            <Route path="/candidatos" element={<CandidatosPage />} />
            <Route path="/candidatos/novo" element={<CandidatoFormPage />} />
            <Route path="/candidatos/:id" element={<CandidatoDetailPage />} />
            <Route path="/candidatos/:id/editar" element={<CandidatoFormPage />} />
            <Route path="/grupos-empresas" element={<GruposEmpresasPage />} />
            <Route path="/empresas" element={<EmpresasPage />} />
            <Route path="/empresas/nova" element={<Navigate to="/grupos-empresas?aba=empresa" replace />} />
            <Route path="/empresas/:id" element={<EmpresaDetailPage />} />
            <Route path="/empresas/:id/editar" element={<EmpresaFormPage />} />
            <Route path="/vagas" element={<VagasPage />} />
            <Route path="/vagas/modelos" element={<ConsultarModelosPage />} />
            <Route path="/vagas/modelos/novo" element={<Navigate to="/grupos-empresas?aba=vaga" replace />} />
            <Route path="/vagas/nova" element={<Navigate to="/grupos-empresas?aba=vaga" replace />} />
            <Route path="/vagas/:id" element={<VagaDetailPage />} />
            <Route path="/vagas/:id/editar" element={<VagaFormPage />} />
            <Route path="/processos" element={<ProcessosPage />} />
            <Route path="/processos/novo" element={<ProcessoFormPage />} />
            <Route path="/processos/:id" element={<ProcessoDetailPage />} />
            <Route path="/contratacoes" element={<ContratacoesPage />} />
            <Route path="/contratacoes/nova" element={<NovaContratacaoPage />} />
            <Route path="/contratacoes/rescisao" element={<RescisaoPage />} />
            <Route path="/contratacoes/rescisao/:id" element={<RescisaoDetailPage />} />
            <Route path="/contratacoes/:id" element={<ContratacaoDetailPage />} />
            <Route path="/termos" element={<TermosPage />} />
            <Route path="/termos/gerar" element={<GerarTcePage />} />
            <Route path="/termos/documentos" element={<GerarDocumentoPage />} />
            <Route path="/termos/:id" element={<TermoDetailPage />} />
            <Route path="/financeiro/faturamento" element={<GerarFaturamentoPage />} />
            <Route path="/financeiro/contas-a-receber" element={<ContasReceberPage />} />
            <Route path="/financeiro/regua" element={<ReguaCobrancaPage />} />
            <Route path="/financeiro/relatorio-procfy" element={<RelatorioProcfyPage />} />
            <Route path="/financeiro/comissao" element={<ComissaoConsultarPage />} />
            <Route path="/financeiro/comissao/empresas" element={<ComissaoEmpresasPage />} />
            <Route path="/financeiro/holerite" element={<GerarHoleritePage />} />
            <Route path="/documentos-pendentes" element={<DocumentosPendentesPage />} />
            <Route path="/emails" element={<EmailsPage />} />
            <Route path="/configuracoes" element={<ConfiguracoesPage />} />
            <Route path="/instituicoes" element={<ConsultarInstituicoesPage />} />
            <Route path="/instituicoes/nova" element={<CadastrarInstituicaoPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
