var keys = WebPush.VapidHelper.GenerateVapidKeys();
Console.WriteLine($"VAPID_PUBLIC_KEY={keys.PublicKey}");
Console.WriteLine($"VAPID_PRIVATE_KEY={keys.PrivateKey}");
Console.WriteLine("VAPID_SUBJECT=mailto:admin@{{DOMAIN}}");
