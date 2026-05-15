# Faceburg Entregador

App Expo/React Native para motoboy.

## Rodar

1. Configure `.env` a partir de `.env.example`.
2. Use um IP acessivel pelo celular em `EXPO_PUBLIC_API_BASE_URL`, por exemplo `http://192.168.0.10:3000`.
3. Instale e rode:

```bash
npm install
npm run start
```

## Fluxo

- Login por `tenantSlug` + `PIN`.
- Se a loja ainda nao tiver motoboy cadastrado, o primeiro login cria o primeiro motoboy com esse PIN.
- O app lista entregas em preparo/em entrega.
- Ao iniciar, chama o backend, muda o pedido para entrega, ativa GPS em segundo plano e abre caminho para rastreio.
- Ao finalizar, chama o backend, muda para entregue, sincroniza a rota salva e encerra o GPS.

## Chaves futuras

As chaves de Google Maps, Expo/Firebase e servidor ficam fora do codigo. Preencha somente quando for testar em aparelho real.
