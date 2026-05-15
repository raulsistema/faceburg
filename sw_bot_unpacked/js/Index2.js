var StatusServer = false, Sair = false, SessaoIniciada = false;

ObterConfiguracoes();

function removeSpecialCharactersAndAccents(str) {
    let normalized = str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return '' + normalized;
}

async function Login() {
    var Login = document.getElementById('txtLogin').value;
    var Senha = document.getElementById('txtSenha').value;

    document.getElementById('btnLogin').disabled = true;

    $.ajax({
        type: 'POST',
        url: 'https://sistemasnaweb.com.br/Login/LoginImpressora',
        data: { Login: Login, Senha: Senha },
        success: function (result) {
            if (!result.status) {
                Swal.fire({
                    type: 'error',
                    icon: 'error',
                    title: 'Opss...',
                    text: result.msg,
                })

                document.getElementById('btnLogin').disabled = false;
            }
            else {
                var Data = new Date(result.dataLimite);
                document.getElementById('txtNomeLojaHidden').value = removeSpecialCharactersAndAccents(result.loja).replaceAll("'", '').replaceAll(' ', '').replaceAll('&', '');

                if (Data < new Date()) {
                    //esta vencido 
                    document.getElementById('cardNotificaoPagamento').classList.remove('d-none');
                    document.getElementById('txtDataVencimento').classList.add('text-danger');
                    document.getElementById('statusServicoImpressao').innerHTML = '<label>Servidor não Inicializado <i style="color: #ff0000; " class="fas fa-circle"></i></label>';
                    document.getElementById('statusBotWhats').innerHTML = '<label> Servidor não Inicializado <i style="color: #ff0000; " class="fas fa-circle"></i></label>';
                }
                else {
                    //não esta vencido
                    document.getElementById('cardNotificaoPagamento').classList.add('d-none');
                    document.getElementById('txtDataVencimento').classList.remove('text-danger');

                    var IniciarWhatsApp = document.querySelector('input[name="btnIniciarWhats"]:checked').value;

                    /*if (IniciarWhatsApp == 'true')
                        IniciarServerBack();
                    else {
                        document.getElementById('statusBotWhats').innerHTML = '<label> Servidor não Inicializado <i style="color: #ff0000; " class="fas fa-circle"></i></label>';
                        //document.getElementById('btnIniciarServerWhatsApp').classList.remove('d-none');
                    }*/
                }

                IniciarServerBack();


                document.getElementById('txtNomeAssinante').innerHTML = '<b>' + result.nome + '</b>';
                document.getElementById('txtDataVencimento').innerHTML = '<b>' + Data.toLocaleString() + '</b>';

                document.getElementById('containerAuth').classList.add('d-none');
                document.getElementById('containerBody').classList.remove('d-none');

                document.getElementById('btnLogin').disabled = false;

                IniciarServerImpressao();
            }


        },
        error: function (XMLHttpRequest, txtStatus, errorThrown) {
            document.getElementById('btnLogin').disabled = false;
        }
    });
};

function Logout() {
    //KillServer();
    document.getElementById('containerAuth').classList.remove('d-none');
    document.getElementById('containerBody').classList.add('d-none');

    //window.location.reload(false);
    Sair = true;
}
/*
async function ObterQrCode(Sessao) {

    var meuInterval = setInterval(async function () {

        if (SessaoIniciada) {
            $('#modalQrCode').modal('hide');
            document.getElementById('containerQrCode').classList.add('d-none');
            clearInterval(meuInterval);
        }

        console.log('aqui');

        fetch('http://localhost:2000/getQrCode?Sessao=' + Sessao, {
            method: 'GET'
        })
            .then(response => response.blob())
            .then(blob => {
                $('#modalQrCode').modal('show');
                console.log(blob);
                document.getElementById('containerQrCode').classList.remove('d-none');
                document.getElementById('imagemQrCode').src = URL.createObjectURL(blob)
            })
            .catch(error => console.error(error));

    }, 5000);

}
*/
async function NovaSessao() {
    var Retorno;
    SessaoIniciada = false;

    document.getElementById('containerSessoesAtivas').classList.remove('d-none');
    document.getElementById('containerAllSessoesAtivas').classList.remove('d-none');

    var Loja = document.getElementById('txtNomeLojaHidden').value;

    var Itens = document.getElementsByName('divSessao').length;
    var NomeSessao = Loja + '00' + (Itens == 0 || Itens == undefined ? 1 : Itens + 1);
    //var ItensAcao = document.getElementsByName('divAcoes').childElementCount != null ? document.getElementsByName('divAcoes').childElementCount : 0;

    var Txt = `
    <div class="d-flex justify-content-between align-items-center" id="divSessao${Itens + 1}" name="divSessao">
        <div>
           ${NomeSessao}
        </div>
        <div name="divAcoes" id="divAcoes${Itens}">               
            <strong>Loading...</strong>
            <div class="spinner-border ms-auto spinner-border-sm" role="status" aria-hidden="true"></div>
        </div>
    </div>`;

    if (Itens == undefined || Itens == 0) {
        document.getElementById('containerSessoesAtivas').innerHTML = Txt;
    }
    else
        document.getElementById('containerSessoesAtivas').innerHTML = document.getElementById('containerSessoesAtivas').innerHTML + Txt;


    document.getElementById('txtContainerAcaoSessao').innerHTML = `
    <strong>Loading...</strong>
    <div class="spinner-border ms-auto spinner-border-sm" role="status" aria-hidden="true"></div>`;

    //ObterQrCode(NomeSessao);

    const respuestaRaw = await fetch('http://localhost:2000/NewSessao?Loja=' + Loja, {
        method: "GET",
        dataType: "json",
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json;charset=UTF-8'
        }
    });



    /*Retorno = await respuestaRaw.json();

    if (Retorno.status) {
        document.getElementById('txtContainerAcaoSessao').innerHTML = `<a href="#" class="btn btn-sm btn-outline btn-outline-dashed btn-outline-success btn-active-light-success" onclick="javascript: NovaSessao()">Nova Sessão</a>`;

        document.getElementById('containerAllSessoesAtivas').classList.remove('d-none');
        $('#modalQrCode').modal('hide');

        var ItensAcao = document.getElementsByName('divAcoes').childElementCount;

        const [letras, numeros] = Retorno.Sessao.split(/(\d+)/);

        document.getElementById(`divSessao${Itens + 1}`).innerHTML = `        
            <div>
                ${letras} - ${numeros}
            </div>
            <div id="divAcoes${ItensAcao + 1}" name="divAcoes">               
                Servidor em Operação <i style="color: #00b712; " class="fas fa-circle ms-2"></i>          
            </div>`;

        //document.getElementById('containerSessoesAtivas').innerHTML = document.getElementById('containerSessoesAtivas').innerHTML + Txt;
        SessaoIniciada = true;
        toastr.success('Servidor Iniciado com Sucesso', 'Sucesso', {
            "closeButton": true,
            "progressBar": true,
            "positionClass": "toast-bottom-right",
            "preventDuplicates": true,
            "onclick": null,
            "showDuration": "3000"
        })
    }
    else {
        document.getElementById('txtContainerAcaoSessao').innerHTML = `<a href="#" class="btn btn-sm btn-outline btn-outline-dashed btn-outline-success btn-active-light-success" onclick="javascript: NovaSessao()">Nova Sessão</a>`;
        document.getElementById('divSessao' + Indice).remove();

        toastr.error('Erro ao Iniciar o servidor!', 'Opss...', {
            "closeButton": true,
            "progressBar": true,
            "positionClass": "toast-bottom-right",
            "preventDuplicates": true,
            "onclick": null,
            "showDuration": "3000"
        })
    }*/
}


async function IniciarServerBack() {
    if (!StatusServer) {
        document.getElementById('statusBotWhats').innerHTML = `
        <div id="statusBotWhats">
            <strong>Loading...</strong>
            <div class="spinner-border ms-auto spinner-border-sm" role="status" aria-hidden="true"></div>
        </div>`;

        var Loja = document.getElementById('txtNomeLojaHidden').value;

        const respuestaRaw = await fetch('http://localhost:2000/IniciarServer?Loja=' + Loja, {
            method: "GET",
            dataType: "json",
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json;charset=UTF-8'
            }
        });

        var Retorno = await respuestaRaw.json();
                
        if (Retorno.status) {
            StatusServer = true;
            document.getElementById('statusBotWhats').innerHTML = '<label>Servidor Inicializado <i style="color: #00b712; " class="fas fa-circle"></i></label>';

            if (Retorno.Sessoes != null && Retorno.Sessoes.length) {

                document.getElementById('containerAllSessoesAtivas').classList.remove('d-none');
                var Txt = '';

                for (var i = 0; i < Retorno.Sessoes.length; i++) {
                    const [letras, numeros] = Retorno.Sessoes[i].split(/(\d+)/);

                    Txt += `
                    <div class="d-flex justify-content-between align-items-center mt-2" id="divSessao${i}" name="divSessao">
                        <div>
                            ${letras.replace('session-', '')} - ${numeros}
                        </div>
                        <div id="divAcoes${i}" name="divAcoes">
                            <a href="javascript:IniciarServerFromSessao('${Retorno.Sessoes[i].replace('.data.json', '').replace('session-', '')}', ${i});" class="btn btn-icon btn-bg-light btn-success btn-sm me-3" title="Iniciar Sessão">
                                <i class="fa-brands fa-whatsapp"></i>
                            </a>
                            <a href="javascript:RemoverServerFromSessao('${Retorno.Sessoes[i].replace('.data.json', '').replace('session-', '')}', ${i});" class="btn btn-icon btn-bg-light btn-danger btn-sm me-3" title="Excluir Sessão">
                                <i class="fas fa-trash fs-5"></i>
                            </a>
                        </div>
                    </div>`;
                }

                document.getElementById('containerSessoesAtivas').innerHTML = Txt;
                await IniciarSessoesLogin(Retorno.Sessoes);

            }
            else
                document.getElementById('containerAllSessoesAtivas').classList.add('d-none');



        }
        else {
            StatusServer = false;
            document.getElementById('statusBotWhats').innerHTML = '<label> Servidor não Inicializado <i style="color: #ff0000; " class="fas fa-circle"></i></label>';
            //document.getElementById('btnIniciarServerWhatsApp').classList.remove('d-none');
        }
    }
    else {
        toastr.success('Servidor Iniciado com Sucesso', 'Sucesso', {
            "closeButton": true,
            "progressBar": true,
            "positionClass": "toast-bottom-right",
            "preventDuplicates": true,
            "onclick": null,
            "showDuration": "3000"
        })
    }

}
async function IniciarSessoesLogin(Sessoes) {
    var IniciarWhatsApp = document.querySelector('input[name="btnIniciarWhats"]:checked').value;
    if (IniciarWhatsApp == 'true') {

        for (var i = 0; i < Sessoes.length; i++) {
            await IniciarServerFromSessao(Sessoes[i].replace('.data.json', '').replace('session-', ''), i);
        }
    }
}
async function RemoverServerFromSessao(Sessao, Indice) {
    const respuestaRaw = await fetch('http://localhost:2000/RemoverServerFromSessao?IdSessao=' + Sessao, {
        method: "GET",
        dataType: "json",
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json;charset=UTF-8'
        }
    });

    var Retorno = await respuestaRaw.json();

    if (Retorno.status) {
        document.getElementById('divSessao' + Indice).remove();

        var Itens = document.getElementsByName('divSessao').length;

        if (Itens == undefined || Itens == 0) {
            document.getElementById('containerAllSessoesAtivas').classList.add('d-none');
        }
    }
    else {
        toastr.error('Erro ao Excluir Sessão!', 'Opss...', {
            "closeButton": true,
            "progressBar": true,
            "positionClass": "toast-bottom-right",
            "preventDuplicates": true,
            "onclick": null,
            "showDuration": "3000"
        })
    }
}
async function IniciarServerFromSessao(Sessao, Indice) {
    document.getElementById('divAcoes' + Indice).innerHTML =
        `<strong>Loading...</strong>
    <div class="spinner-border ms-auto spinner-border-sm" role="status" aria-hidden="true"></div>`;
    //ObterQrCode(Sessao);

    const respuestaRaw = await fetch('http://localhost:2000/IniciarServerFromSessao?IdSessao=' + Sessao +'&Indice=' + Indice, {
        method: "GET",
        dataType: "json",
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json;charset=UTF-8'
        }
    });

    /*var Retorno = await respuestaRaw.json();

    if (Retorno.status) {
        $('#modalQrCode').modal('hide');
        document.getElementById('divAcoes' + Indice).innerHTML = `
        Servidor em Operação <i style="color: #00b712; " class="fas fa-circle ms-2"></i>`;
    }
    else {
        document.getElementById('divAcoes' + Indice).innerHTML = `
        <a href="javascript:IniciarServerFromSessao('${Sessao}', ${Indice});" class="btn btn-icon btn-bg-light btn-success btn-sm me-3" title="Iniciar Sessão">
            <i class="fa-brands fa-whatsapp"></i>
        </a>
        <a href="javascript:RemoverServerFromSessao('${Sessao}', ${Indice});" class="btn btn-icon btn-bg-light btn-danger btn-sm me-3" title="Excluir Sessão">
            <i class="fas fa-trash fs-5"></i>
        </a>`;
    }*/
}
async function IniciarServerImpressao() {
    var Login = document.getElementById('txtLogin').value;
    var Senha = document.getElementById('txtSenha').value;

    const payload = {
        Login: Login,
        Senha: Senha
    };

    const respuestaRaw = await fetch('http://localhost:8000/IniciarServerImpressao', {
        method: "POST",
        dataType: "json",
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json;charset=UTF-8'
        },
        body: JSON.stringify(payload),
    });


    var Retorno = await respuestaRaw.json();

    if (Retorno.status)
        document.getElementById('statusServicoImpressao').innerHTML = '<label>Servidor Inicializado <i style="color: #00b712; " class="fas fa-circle"></i></label>';
    else
        document.getElementById('statusServicoImpressao').innerHTML = '<label>Servidor não Inicializado <i style="color: #ff0000; " class="fas fa-circle"></i></label>';

}

function ObterImpressoras() {
    $.ajax({
        type: 'POST',
        url: 'http://localhost:8000/impresoras',
        success: function (result) {
            alert(result.Impressoras);
            alert(result.impressoras);

        },
        error: function (XMLHttpRequest, txtStatus, errorThrown) {
            alert('erro')
        }
    });
}

async function LogoutSessao(Sessao) {

    const payload = {
        Sessao: Sessao
    };

    const respuestaRaw = await fetch('http://localhost:2000/KillServer', {
        method: "POST",
        dataType: "json",
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json;charset=UTF-8'
        },
        body: JSON.stringify(payload),
    });


    var Retorno = await respuestaRaw.json();

    //if(Retorno.status)

};
async function GravarConfiguracao(Pos) {
    //var Url = 'http://localhost:8000/GravarConfiguracao';
    var Value = '';

    if (Pos == 0) {
        Value = document.querySelector('input[name="btnIniciarWhats"]:checked').value;
    }
    else {
        if (Pos == 1) {
            Value = document.getElementById('cbbFonte').value;
        }
        else {
            if (Pos == 4)
                Value = document.getElementById('cbbTamanhoFonte').value;
            else {
                if (Pos == 5)
                    Value = document.getElementById('cbbTipoColeta').value;
                else {
                    if (Pos == 6)
                        Value = document.getElementById('cbbTipoPix').value;
                    else {
                        if (Pos == 7)
                            Value = document.getElementById('cbbTipoMenu').value;
                        else {
                            if (Pos == 8)
                                Value = document.getElementById('cbbMensagemInicial').value;
                            else {
                                if (Pos == 9)
                                    Value = document.getElementById('cbbRetirada').value;
                                else {
                                    if (Pos == 10)
                                        Value = document.getElementById('cbbMensagemAjuda').value;
                                    else {
                                        if (Pos == 11)
                                            Value = document.getElementById('cbbApenasInicial').value;
                                        else{
                                            if (Pos == 12)
                                                Value = document.getElementById('txtMensagemPersonalizada').value.replaceAll('\n', '<br>');
                                            else{
                                                if(Pos == 13)
                                                    Value = document.getElementById('cbbMaximoResposta').value;
                                                else{
                                                    if(Pos == 14)
                                                        Value = document.getElementById('txtNotificacaoPedido').value.replaceAll('\n', '<br>');
                                                    else
                                                    {
                                                        if(Pos == 15)
                                                            Value = document.getElementById('txtNotificacaoCozinha').value.replaceAll('\n', '<br>');
                                                        else{
                                                            if(Pos == 16)
                                                                Value = document.getElementById('txtNotificacaoEntrega').value.replaceAll('\n', '<br>');
                                                            else{
                                                                if(Pos == 17)
                                                                    Value = document.getElementById('txtNotificacaoEntregue').value.replaceAll('\n', '<br>');
                                                                else{
                                                                    if(Pos == 18)
                                                                        Value = document.getElementById('txtNotificacaoCancelamento').value.replaceAll('\n', '<br>');
                                                                    else{
                                                                        if(Pos == 19)
                                                                            Value = document.getElementById('txtNotificacaoPix').value.replaceAll('\n', '<br>');
                                                                        else{
                                                                            if(Pos == 20)
                                                                                Value = document.getElementById('txtNotificacaoInativo').value.replaceAll('\n', '<br>');
                                                                            else{
                                                                                if(Pos == 21)
                                                                                    Value = document.getElementById('cbbRemoveNumber').value.replaceAll('\n', '<br>');
                                                                                else
                                                                                    Value = document.getElementById('txtCaminhoChrome').value.replaceAll('\n', '<br>');

                                                                            }

                                                                        }
                                                                    }
                                                                }
                                                            }
                                                        }
                                                    }
                                                }

                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    const payload = {
        Value: Value,
        Pos: Pos
    };

    const respuestaRaw = await fetch('http://localhost:8000/GravarConfiguracao', {
        method: "POST",
        dataType: "json",
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json;charset=UTF-8'
        },
        body: JSON.stringify(payload),
    });
}

async function Teste(){
    const respuestaRaw = await fetch('http://localhost:3000/Teste', {
        method: "GET",
        dataType: "json",
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json;charset=UTF-8'
        }
    });
}

function ObterConfiguracoes() {
    $.ajax({
        type: 'GET',
        url: 'http://localhost:8000/ObterConfig',
        success: function (result) {
            if (result.WhatsApp == 'true')
                document.getElementById('btnIniciarWhats1').checked = true;
            else
                document.getElementById('btnIniciarWhats2').checked = true;

            document.getElementById('cbbRetirada').value = result.Retirada;
            document.getElementById('cbbMensagemInicial').value = result.MensagemSaudacao;
            document.getElementById('cbbMensagemAjuda').value = result.Ajuda;
            document.getElementById('cbbApenasInicial').value = result.ApenasInicial;


            document.getElementById('cbbTipoColeta').value = result.TipoColeta;
            document.getElementById('cbbTipoPix').value = result.TipoPix;
            document.getElementById('cbbTipoMenu').value = result.TipoMenu;

            document.getElementById('cbbFonte').value = result.Fonte;
            document.getElementById('cbbTamanhoFonte').value = result.TamanhoFonte;

            document.getElementById('txtLogin').value = result.Usuario;
            document.getElementById('txtSenha').value = result.Senha;

            document.getElementById('txtMensagemPersonalizada').value = result.MensagemPersonalizada.replaceAll('<br>', '\n');

            document.getElementById('cbbMaximoResposta').value = result.MaximoResposta;
            document.getElementById('cbbRemoveNumber').value = result.RemoverNumber;

            document.getElementById('txtNotificacaoInativo').value = result.MsgNotificacao.replaceAll('<br>', '\n');
            document.getElementById('txtNotificacaoPix').value = result.MsgPix.replaceAll('<br>', '\n');
            document.getElementById('txtNotificacaoCancelamento').value = result.MsgCancelamento.replaceAll('<br>', '\n');
            document.getElementById('txtNotificacaoEntregue').value = result.MsgEntregue.replaceAll('<br>', '\n');
            document.getElementById('txtNotificacaoEntrega').value = result.MsgEntrega.replaceAll('<br>', '\n');
            document.getElementById('txtNotificacaoCozinha').value = result.MsgCozinha.replaceAll('<br>', '\n');
            document.getElementById('txtNotificacaoPedido').value = result.MsgPedido.replaceAll('<br>', '\n');

            document.getElementById('txtCaminhoChrome').value = result.CaminhoNavegador.replaceAll('<br>', '\n');


            if (result.Usuario != null && result.Usuario != "" && result.Senha != null && result.Senha != "" && !Sair)
                Login();

        },
        error: function (XMLHttpRequest, txtStatus, errorThrown) {

        }
    });
}

function AbrirConfiguracaoWhats() {
    var drawerElement = document.getElementById("kt_Config_Whats");
    var drawer = KTDrawer.getInstance(drawerElement);
    drawer.show();

}

function AbrirConfiguracaoMensagens(){
    var drawerElement = document.getElementById("kt_Config_Mensagens");
    var drawer = KTDrawer.getInstance(drawerElement);
    drawer.show();
};

function AbrirConfiguracaoImpressora() {
    var drawerElement = document.getElementById("kt_Config_Impressora");
    var drawer = KTDrawer.getInstance(drawerElement);
    drawer.show();

}

// Cria uma nova instância do WebSocket
const socket = new WebSocket('ws://localhost:9000');

// Quando a conexão for estabelecida com sucesso
socket.addEventListener('open', (event) => {
  console.log('Conexão estabelecida com sucesso!');
});

// Quando o servidor enviar uma mensagem
socket.addEventListener('message', (event) => {
    //abre modal e exibi qrcode
    const mensagem = JSON.parse(event.data);

    if(mensagem.acao == 1)
    {        
        console.log('to aqui ;;; ')

        $('#modalQrCode').modal('show');

        document.getElementById('containerQrCode').classList.remove('d-none');
        document.getElementById('imagemQrCode').src = `data:image/png;base64,${mensagem.code}`;
    }
    else{
        if(mensagem.acao == 2){
            $('#modalQrCode').modal('hide');

            document.getElementById('txtContainerAcaoSessao').innerHTML = `<a href="#" class="btn btn-sm btn-outline btn-outline-dashed btn-outline-success btn-active-light-success" onclick="javascript: NovaSessao()">Nova Sessão</a>`;
    
            /*var ItensAcao = (document.getElementsByName('divAcoes').childElementCount != null ? document.getElementsByName('divAcoes').childElementCount : 0);
            
            console.log(`divAcoes${ItensAcao}`);*/

            document.getElementById(`divAcoes${mensagem.indice}`).innerHTML = `        
                Servidor em Operação <i style="color: #00b712; " class="fas fa-circle ms-2"></i>          
            `;

            document.getElementById('containerQrCode').classList.add('d-none');

            SessaoIniciada = true;
            toastr.success('Servidor Iniciado com Sucesso', 'Sucesso', {
                "closeButton": true,
                "progressBar": true,
                "positionClass": "toast-bottom-right",
                "preventDuplicates": true,
                "onclick": null,
                "showDuration": "3000"
            })
        }
        else{
            if(mensagem.acao == 5)
                {       
                    if(mensagem.msg != null && mensagem.msg.percent > 0)
                    {
                        $('#kt_modal_progresso').modal('show');             
                        document.getElementById('progressBarNFe').innerHTML = `<div class="progress-bar progress-bar-striped progress-bar-animated " role="progressbar" style="width: ${mensagem.msg.percent.toFixed(2)}%" aria-valuenow="${mensagem.msg.percent.toFixed(2)}" aria-valuemin="0" aria-valuemax="100">${mensagem.msg.percent.toFixed(2)}%</div>`;

                        if(mensagem.msg.percent == 100){
                            setTimeout(() => {
                                $('#kt_modal_progresso').modal('hide');             

                                const toastElement = document.getElementById('kt_docs_toast_toggle');
                
                                // Get toast instance --- more info: https://getbootstrap.com/docs/5.1/components/toasts/#getinstance
                                const toast = bootstrap.Toast.getOrCreateInstance(toastElement);
                                // Toggle toast to show --- more info: https://getbootstrap.com/docs/5.1/components/toasts/#show
                                toast.show();

                            }, 5000);

                        }
                    }
                }
                else{
                    if(mensagem.acao == 6){
                        console.log(mensagem.Usuario);
                        console.log(mensagem.Senha);

                       if(!document.getElementById('containerAuth').classList.contains('d-none') && mensagem.Usuario != '' && mensagem.Senha != ''){                
                        document.getElementById('txtLogin').value = mensagem.Usuario;
                        document.getElementById('txtSenha').value = mensagem.Senha;
                        document.getElementById('btnLogin').click();

                       }
                    }
                    else
                        console.log(mensagem.msg)
                }
        }
    }
});


// Quando ocorrer um erro na conexão
socket.addEventListener('error', (event) => {
  console.error('Erro na conexão:', event);
});

// Quando a conexão for fechada
socket.addEventListener('close', (event) => {
  console.log('Conexão fechada.');
});


//////signalr//////////
"use strict";
var streaminghub = new signalR.HubConnectionBuilder().withUrl("https://www.sistemasnaweb.com.br/streaminghub", { transport: signalR.HttpTransportType.ServerSentEvents }).withAutomaticReconnect([1000]).build();
//var streaminghub = new signalR.HubConnectionBuilder().withUrl("/streaminghub").build();
streaminghub.on("ReceiveMessage", function (message) {
    var msg = message.replace(/&/g, "&").replace(/</g, "<").replace(/>/g, ">"); //devolve os dados em json ...
    const obj = JSON.parse(msg); //convert para objeto javascript

    var Icon = '', Valor = '', Agendamento = '', Retirada = '', StatusPagamento = '', NumPedido = '', LinkWhats = `https://api.whatsapp.com/send?phone=55@TELFONE&amp;text=`, BtnEntrega = '';
    console.log(obj);

    if (obj.adm == Adm) {
        if (obj.operation == 1) {
            if (obj.codigoMesa == 0) {
                if (obj.data.Andamento < 4) {
                    var Entr = new Object();

                    if (obj.data.NumeroPedido > 0)
                        Entr.Codigo = ("0000000" + obj.data.NumeroPedido).slice(-4);
                    else
                        Entr.Codigo = obj.data.Codigo;

                    Entr.Id = obj.data.Codigo
                    Entr.Nome = obj.data.Pessoa.Nome;
                    Entr.DataPedido = obj.data.Data;
                    Entr.PrevisaoEntrega = obj.data.PrevisaoEntrega;
                    Entr.TipoPagamento = obj.data.TipoPagamento.Nome;
                    Entr.Troco = obj.data.Troco;
                    Entr.Entregador = '';


                    var index = Entregas.find(element => element.Id == obj.data.Codigo);

                    if (index == null)
                        Entregas.push(Entr);
                }

                if (obj.data.CodigoVenda != "") {
                    Icon = "https://sisenor.com.br/wp-content/uploads/2021/03/ico-ifood.png";
                }
                else {
                    Icon = "/img/icons/logoSW.png";
                }

                if (obj.data.Andamento == 4 || obj.data.StatusPagamento || obj.data.ValorPagar == 0) {
                    Valor = '<b>Valor: R$ <span id="txtValorVenda' + obj.data.Codigo + '">' + obj.data.ValorPagar.toFixed(2).replace('.', ',');
                    StatusPagamento = '<span class="badge badge-success fs-7" id="badgePagamentoPedido' + obj.data.Codigo + '" style="margin-left: 5px">Pgo</span>' + TipoPagamento(removeSpecialCharactersAndAccents(obj.data.TipoPagamento.Nome), obj.data.Troco);
                }
                else {
                    if (obj.data.TipoPagamento.Cashback) {
                        Valor = '<b>Valor: R$ <span id="txtValorVenda' + obj.data.Codigo + '">' + obj.data.ValorPagar.toFixed(2).replace('.', ',');
                        StatusPagamento = '<span class="badge badge-primary fs-7" id="badgePagamentoPedido' + obj.data.Codigo + '" style="margin-left: 5px">Cash</span>' + TipoPagamento(removeSpecialCharactersAndAccents(obj.data.TipoPagamento.Nome), obj.data.Troco);
                    }
                    else {
                        Valor = '<b>Valor: R$ <span id="txtValorVenda' + obj.data.Codigo + '">' + obj.data.ValorPagar.toFixed(2).replace('.', ',');
                        StatusPagamento = '<span class="badge badge-danger fs-7" id="badgePagamentoPedido' + obj.data.Codigo + '" style="margin-left: 5px">Ñ Pgo</span>' + TipoPagamento(removeSpecialCharactersAndAccents(obj.data.TipoPagamento.Nome), obj.data.Troco);
                    }
                }

                if (obj.data.Agendado) {
                    Agendamento = `<span class="badge bg-primary fs-7" data-bs-placement="bottom" data-toggle="tooltip" title="Inicio Preparo: ${new Date(obj.data.PrevisaoEntrega).toLocaleString()}">Agendada</span>`;
                }
                else {
                    Agendamento = '';
                }

                if (obj.data.EnderecoEntrega == "" || obj.data.EnderecoEntrega == undefined) {
                    Retirada = '<div class="col-lg-3"><span class="badge fs-7 bg-primary" data-bs-placement="bottom" data-toggle="tooltip" title="Venda será retirada no estabelecimento!">Retirada</span></div>';
                    BtnEntrega = '';
                    Entregar = false;

                }
                else {
                    if (obj.data.EnderecoEntrega.Codigo > 1) {
                        Retirada = '';
                        BtnEntrega = `
                                        <div class="menu-item px-1">
                                            <a id="btnEntregador${obj.data.Codigo}" href="javascript: AbrirModalEntregador(${obj.data.Codigo}, '${obj.data.CodigoVenda}')" class="menu-link px-1 text-hover-warning">
                                                <i class="fa-solid fa-truck me-2 pe-0" style="font-size: 15px"></i>
                                                Entregador
                                            </a>
                                        </div>`;
                        Entregar = true;
                    }
                    else {
                        Retirada = '<div class="col-lg-3"><span class="badge bg-primary" data-bs-placement="bottom" data-toggle="tooltip" title="Venda será consumida no estabelecimento!">Consumir Local</span></div>';
                        BtnEntrega = '';
                        Entregar = false;
                    }
                }

                if (obj.data.NumeroPedido > 0)
                    NumPedido = ("0000000" + obj.data.NumeroPedido).slice(-4);
                else
                    NumPedido = obj.data.Codigo;

                if (obj.data.Pessoa.Celular != "")
                    LinkWhats = `
                                    <div class="menu-item px-1">
                                        <a href="${(LinkWhats.replace('@TELFONE', (obj.data.Pessoa.Celular.replace('(', '').replace(')', '').replace('-', '').replace(' ', ''))))}" target="_blank" class="menu-link px-1 text-hover-success">
                                            <i class="fa-brands fa-whatsapp me-2 pe-0" style="font-size: 15px"></i>
                                            WhatsApp
                                        </a>
                                    </div>`;
                else
                    LinkWhats = '';


                Botoes = ObterBotoesAcao(LinkWhats, obj.data.Codigo, obj.data.CodigoVenda, BtnEntrega, obj.data.Andamento);

                var txt = '                <article class="card border border-gray-400 position-relative card-rounded" draggable="true" data-value="' + obj.data.Codigo + '" data-codigoEcomerce="' + obj.data.CodigoVenda + '" data-entregar="' + Entregar + '" id="' + obj.data.Codigo + '"  data-celular="' + obj.data.Pessoa.Celular + '" data-pagamento="' + obj.data.TipoPagamento.Nome + '">\
                                            <div class="d-flex justify-content-start">\
                                                <div class="hiddenMobile-block" style="padding-right: 10px; width: 20% !important">\
                                                    <img src="'+ Icon + '" class="img-fluid border" style="border-radius: 50%" alt="...">\
                                                </div>\
                                                <div class="div-80-a-100">\
                                                    <div class="row">\
                                                        <div class="col-lg-6">\
                                                            <p><b>Código:  <a href="/Venda/RelatorioVendas?Codigo='+ obj.data.Codigo + '" target="_blank">' + NumPedido + '</b></a></p>\
                                                        </div>'+ Retirada + '\
                                                    </div>\
                                                    <div class="row">\
                                                        <div class="col-lg-12">\
                                                            <p><b>Nome: '+ obj.data.Pessoa.Nome + '</b></p>\
                                                        </div>\
                                                    </div>\
                                                   <div class="row">\
                                                        <div class="col-lg-12">\
                                                            <p class="text-muted">'+ Valor + '</span></b></p>\
                                                        </div>\
                                                    </div>\
                                                    <div class="row">\
                                                        <div class="col-lg-12">' + StatusPagamento + Agendamento + '<label id="divEntregador' + obj.data.Codigo + '"></label></div>\
                                                    </div>\
                                                 </div>\
                                            </div>\
                                            <div class="d-flex justify-content-between mt-2">\
                                                <div id="containerBtnProximo'+ obj.data.Codigo + '" class="ocultarbtndesk">\
                                                    <button class="btn btn-sm btn-primary" onclick="javascript: ProximoPasso('+ obj.data.Codigo + ',' + "'" + obj.data.CodigoVenda + "'" + ')" tooltip="Próximo Status Comanda"><span class="hiddenMobile-block">Próximo</span> <i class="fa fa-arrow-right" aria-hidden="true"></i> </button>\
                                                </div>'+ Botoes + '\
                                            </div>\
                                        </article>';


                document.getElementById('cardPedido').innerHTML = document.getElementById('cardPedido').innerHTML + txt;
                notify("Novo Pedido o/", "Novo Pedido Recebido!");
                ComunicarClienteComanda(obj.data.Codigo, obj.data.Pessoa.Celular)
                const cards = document.querySelectorAll('.card');
                const lists = document.querySelectorAll('.list__content');

                cards.forEach(card => {
                    card.addEventListener('dragstart', dragstart);
                    card.addEventListener('drag', drag);
                    card.addEventListener('dragend', dragend);
                });

                lists.forEach(list => {
                    list.addEventListener('dragover', dragover);
                    list.addEventListener('dragleave', dragleave);
                    list.addEventListener('drop', drop);
                });

                ObterQuantidadeStatus();
                $('[data-toggle=tooltip]').tooltip();

                if (document.getElementById('btnAlertaSonoro').checked) {
                    var sound = new Howl({
                        src: [`/audio/camp${Campainha}.mp3`],
                        volume: 1.0,
                        onend: function () {

                        }
                    });

                    sound.play();
                }

            }           
        }
        
    }

});
streaminghub.start().then(function () {
    streaminghub.invoke("JoinGroup", "32")  //JoinGroup is C# method name
        .catch(err => {
            console.log(err);
        });
}).catch(function (err) {
});