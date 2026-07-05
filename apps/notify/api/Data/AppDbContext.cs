using Microsoft.EntityFrameworkCore;

namespace NotifyService.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<PushSubscription> PushSubscriptions => Set<PushSubscription>();
    public DbSet<Notification> Notifications => Set<Notification>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<PushSubscription>(e =>
        {
            e.HasIndex(x => x.UserUid);
            e.HasIndex(x => x.Endpoint).IsUnique();
        });

        b.Entity<Notification>(e =>
        {
            e.HasIndex(x => new { x.UserUid, x.CreatedAt });
        });
    }
}
